import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from '../utils/git';
import { WorkspaceService } from './workspaceService';

export class GitBranchService {
    private workspaceService: WorkspaceService;

    constructor(private readonly gitUtils: GitUtils) {
        this.workspaceService = WorkspaceService.getInstance();
    }

    async createBranchAndCherryPick(version: string, cherryPickCommit: string, newBranch: string): Promise<boolean> {
        try {
            // Validate commit exists
            const commitExists = await this.gitUtils.execCommand(`git cat-file -t ${cherryPickCommit}`).catch(() => false);
            if (!commitExists) {
                throw new Error(`Commit ${cherryPickCommit} not found`);
            }

            // Fetch and validate version branch
            await this.gitUtils.execCommand('git fetch --all');
            const versionBranchExists = await this.gitUtils.execCommand(`git branch -r | grep -w "origin/${version}"`).catch(() => '');
            
            if (!versionBranchExists) {
                vscode.window.showWarningMessage(`Version branch '${version}' not found remotely`);
                return false;
            }

            // Track version branch if it doesn't exist locally
            await this.gitUtils.execCommand(`git checkout -B ${version} origin/${version}`).catch(async (error) => {
                console.log(`Failed to checkout ${version}, trying to create tracking branch`);
                await this.gitUtils.execCommand(`git branch --track ${version} origin/${version}`);
                await this.gitUtils.execCommand(`git checkout ${version}`);
            });

            // Create new branch
            if (await this.gitUtils.branchExists(newBranch)) {
                const action = await this.handleExistingBranch(newBranch);
                if (!action) {return false;}
                newBranch = action;
            }

            // Create new branch from version branch
            await this.gitUtils.execCommand(`git checkout -b ${newBranch} ${version}`);

            // Attempt cherry-pick
            try {
                const isMergeCommit = await this.gitUtils.checkIfMergeCommit(cherryPickCommit);
                const cherryPickCommand = isMergeCommit ? 
                    `git cherry-pick -m 1 ${cherryPickCommit}` : 
                    `git cherry-pick ${cherryPickCommit}`;

                await this.gitUtils.execCommand(cherryPickCommand);
            } catch (error: any) {
                if (error.message.includes('could not apply')) {
                    return this.handleCherryPickConflict(newBranch);
                }
                throw error;
            }

            // Push new branch
            await this.gitUtils.execCommand(`git push -u origin ${newBranch}`);
            return true;

        } catch (error: any) {
            console.error('Branch creation failed:', error);
            vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
            return false;
        }
    }

    private async handleExistingBranch(branchName: string): Promise<string | null> {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Use Existing', description: 'Continue with existing branch' },
                { label: 'Create New', description: 'Create branch with timestamp' }
            ],
            { placeHolder: `Branch ${branchName} exists. What would you like to do?` }
        );

        if (choice?.label === 'Use Existing') {
            await this.gitUtils.execCommand(`git checkout ${branchName}`);
            return branchName;
        } else if (choice?.label === 'Create New') {
            const newName = `${branchName}-${Date.now()}`;
            return newName;
        }
        return null;
    }

    private async handleCherryPickConflict(branchName: string): Promise<boolean> {
        const shouldResolve = await vscode.window.showQuickPick(
            [
                { label: 'Yes', description: 'Resolve conflicts' },
                { label: 'No', description: 'Abort cherry-pick' }
            ],
            { placeHolder: 'Conflicts detected. Resolve conflicts?' }
        );

        if (shouldResolve?.label === 'Yes') {
            return this.resolveConflicts(branchName);
        }

        await this.gitUtils.execCommand('git cherry-pick --abort');
        return false;
    }

    private async resolveConflicts(branchName: string): Promise<boolean> {
        try {
            const conflictedFiles = await this.getConflictedFiles();
            await this.openConflictedFiles(conflictedFiles);
            const resolution = await this.waitForConflictResolution(conflictedFiles);

            if (resolution === 'continue') {
                await this.gitUtils.execCommand('git add .');
                await this.gitUtils.execCommand('git cherry-pick --continue');
                await this.gitUtils.execCommand(`git push origin ${branchName}`);
                return true;
            }
            
            await this.gitUtils.execCommand('git cherry-pick --abort');
            return false;

        } catch (error) {
            console.error('Conflict resolution failed:', error);
            return false;
        }
    }

    private async getConflictedFiles(): Promise<string[]> {
        const output = await this.gitUtils.execCommand('git diff --name-only --diff-filter=U');
        return output.split('\n').filter(file => file.trim());
    }

    private async openConflictedFiles(files: string[]): Promise<void> {
        for (const file of files) {
            const uri = vscode.Uri.file(path.join(this.workspaceService.workspacePath, file));
            await vscode.window.showTextDocument(uri, { preview: false });
        }
        await vscode.commands.executeCommand('workbench.view.scm');
    }

    private async waitForConflictResolution(files: string[]): Promise<'continue' | 'cancel'> {
        return new Promise((resolve) => {
            const watchers = files.map(file => 
                vscode.workspace.createFileSystemWatcher(
                    path.join(this.workspaceService.workspacePath, file)
                )
            );

            const disposables: vscode.Disposable[] = [];
            watchers.forEach(watcher => {
                disposables.push(
                    watcher.onDidChange(async () => {
                        const choice = await vscode.window.showInformationMessage(
                            'Have you resolved all conflicts?',
                            'Yes', 'Continue Editing', 'Cancel'
                        );

                        if (choice === 'Yes') {
                            disposables.forEach(d => d.dispose());
                            watchers.forEach(w => w.dispose());
                            resolve('continue');
                        } else if (choice === 'Cancel') {
                            disposables.forEach(d => d.dispose());
                            watchers.forEach(w => w.dispose());
                            resolve('cancel');
                        }
                        // If "Continue Editing" is selected, do nothing
                        // The watchers remain active, and the promise is not resolved
                    })
                );
            });
        });
    }
}