import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from '../utils/git';
import { WorkspaceService } from './workspaceService';
import { StateService } from './stateService';

export class GitBranchService {
    private workspaceService: WorkspaceService;

    constructor(private readonly gitUtils: GitUtils,
                private readonly stateService: StateService
    ) {
        this.workspaceService = WorkspaceService.getInstance();
    }

    async createBranchAndCherryPick(version: string, cherryPickCommit: string, newBranch: string): Promise<boolean> {
        const originalBranch = await this.gitUtils.execCommand('git rev-parse --abbrev-ref HEAD');
        
        try {
            // Validate commit exists
            const commitExists = await this.gitUtils.execCommand(`git cat-file -t ${cherryPickCommit}`).catch(() => false);
            if (!commitExists) {
                throw new Error(`Commit ${cherryPickCommit} not found`);
            }
    
            // Fetch latest changes
            await this.gitUtils.execCommand('git fetch --all');
    
            // Check if branch exists and handle
            const branchExists = await this.gitUtils.branchExists(newBranch);
            if (branchExists) {
                const newBranchName = await this.handleExistingBranch(newBranch);
                if (!newBranchName) {
                    return false;
                }
            }
    
            // Checkout version branch and create new branch
            await this.gitUtils.execCommand(`git checkout ${version}`);
            await this.gitUtils.execCommand(`git checkout -b ${newBranch}`);
    
            // Check if commit is a merge commit
            const isMergeCommit = await this.gitUtils.checkIfMergeCommit(cherryPickCommit);
            
            // Attempt cherry-pick with appropriate flags
            try {
                const cherryPickCmd = isMergeCommit 
                    ? `git cherry-pick -m 1 ${cherryPickCommit}`
                    : `git cherry-pick ${cherryPickCommit}`;
                    
                await this.gitUtils.execCommand(cherryPickCmd);
                return true;
            } catch (error: any) {
                const hasConflicts = error.stderr?.includes('needs merge') || 
                                    error.stderr?.includes('could not apply');
                                    
                if (hasConflicts) {
                    const resolved = await this.handleCherryPickConflict(newBranch);
                    if (!resolved) {
                        await this.cleanupAndRestore(newBranch, originalBranch).catch(() => {});
                        return false;
                    }
                    return true;
                }
                throw error;
            }
        } catch (error: any) {
            const expectedErrors = [
                'no cherry-pick or revert in progress',
                'could not apply',
                'needs merge',
                'already exists',
                'is a merge but no -m option was given'
            ];
            
            if (!expectedErrors.some(msg => error.stderr?.includes(msg))) {
                await this.handleBranchCreationError(error, newBranch, originalBranch);
            }
            
            await this.cleanupAndRestore(newBranch, originalBranch).catch(() => {});
            return false;
        }
    }

    private async cleanupAndRestore(branchName: string, originalBranch: string): Promise<void> {
        try {
            // Check if we're in a cherry-pick state
            const status = await this.gitUtils.execCommand('git status');
            if (status.includes('cherry-pick')) {
                try {
                    await this.gitUtils.execCommand('git cherry-pick --abort');
                } catch (cherryPickError) {
                    // Ignore errors from cherry-pick abort
                    console.log('Cherry-pick abort failed, continuing with cleanup');
                }
            }
    
            // Reset any pending changes
            await this.gitUtils.execCommand('git reset --hard');
            
            // Now safe to checkout original branch
            await this.gitUtils.execCommand(`git checkout ${originalBranch}`);
    
            // Try to delete the branch if it exists and isn't checked out
            const currentBranch = await this.gitUtils.execCommand('git rev-parse --abbrev-ref HEAD');
            if (branchName !== currentBranch) {
                const exists = await this.gitUtils.branchExists(branchName);
                if (exists) {
                    await this.gitUtils.execCommand(`git branch -D ${branchName}`);
                }
            }
        } catch (error) {
            console.log('Cleanup operation failed:', error);
        }
    }

    // use at some point
    private async handleBranchCreationError(error: any, newBranch: string, originalBranch: string): Promise<void> {
        console.error('Branch creation failed:', error);
        
        // Categorize error type
        let errorMessage = 'Unknown error occurred';
        if (error.message.includes('already exists')) {
            errorMessage = `Branch ${newBranch} already exists`;
        } else if (error.message.includes('Permission denied')) {
            errorMessage = 'Permission denied - check your git credentials';
        } else if (error.message.includes('could not apply')) {
            errorMessage = 'Cherry-pick failed - conflicts detected';
        } else if (error.message.includes('not found')) {
            errorMessage = 'Remote branch or commit not found';
        } else if (error.message.includes('network')) {
            errorMessage = 'Network error - check your connection';
        }
    
        // Always try to cleanup
        await this.cleanupAndRestore(newBranch, originalBranch);
        vscode.window.showErrorMessage(`Failed to create branch: ${errorMessage}`);
    }

    private async handleExistingBranch(branchName: string): Promise<string | null> {
        const choice = await vscode.window.showQuickPick([
            { label: 'Auto-rename', description: 'Create branch with timestamp suffix' },
            { label: 'Delete and recreate', description: 'Delete existing branch and create new one. This will delete local and remote branches.' },
            { label: 'Cancel', description: 'Abort branch creation' }
        ], {
            placeHolder: `Branch ${branchName} already exists. What would you like to do?`
        });
    
        switch (choice?.label) {
            case 'Auto-rename':
                return `${branchName}-${Date.now()}`;
    
            case 'Delete and recreate':
                try {
                    // Check if local branch exists and delete it
                    const localExists = await this.gitUtils.branchExists(branchName);
                    if (localExists) {
                        const currentBranch = await this.gitUtils.execCommand('git rev-parse --abbrev-ref HEAD');
                        if (currentBranch === branchName) {
                            await this.gitUtils.execCommand('git checkout main');
                        }
                        await this.gitUtils.execCommand(`git branch -D ${branchName}`);
                    }
    
                    // Safely check and delete remote branch if it exists
                    const remoteExists = await this.gitUtils.execCommand(`git ls-remote --heads origin ${branchName}`)
                        .then(output => output.length > 0)
                        .catch(() => false);
    
                    if (remoteExists) {
                        try {
                            await this.gitUtils.execCommand(`git push origin --delete ${branchName}`);
                        } catch (error) {
                            // Remote branch might be already deleted - continue
                            console.log(`Remote branch ${branchName} not found or already deleted`);
                        }
                    }
                    return branchName;
                } catch (error: any) {
                    const newName = `${branchName}-${Date.now()}`;
                    vscode.window.showWarningMessage(`Failed to delete branch. Creating ${newName} instead`);
                    return newName;
                }
    
            case 'Cancel':
            default:
                return null;
        }
    }

    private async handleCherryPickConflict(branchName: string): Promise<boolean> {
        try {
            const status = await this.gitUtils.execCommand('git status');
            const hasConflicts = status.includes('You have unmerged paths');
    
            await this.stateService.updateCherryPickState({
                inProgress: true,
                branch: branchName,
                hasConflicts: hasConflicts
            });
    
            const conflictedFiles = await this.getConflictedFiles();
            if (conflictedFiles.length === 0) {
                return true;
            }
    
            await this.openConflictedFiles(conflictedFiles);
            const resolved = await this.resolveConflicts(conflictedFiles);
            
            if (!resolved) {
                // Silently abort without throwing error
                try {
                    await this.gitUtils.execCommand('git cherry-pick --abort');
                } catch (error) {
                    // Ignore abort errors
                }
                return false;
            }
            return true;
    
        } catch (error) {
            console.error('Unexpected error in cherry-pick conflict handling:', error);
            await this.stateService.updateCherryPickState({
                inProgress: false,
                hasConflicts: false
            });
            return false;
        }
    }
    
    private async resolveConflicts(files: string[]): Promise<boolean> {
        try {
            console.log('Opening conflicted files:', files);
            await this.openConflictedFiles(files);
    
            // First ask if user wants to resolve conflicts
            const shouldResolve = await vscode.window.showInformationMessage(
                'Would you like to resolve the conflicts? NOTE: Save after resolving conflicts to continue.',
                { modal: true },
                'Yes', 'No'
            );
    
            if (shouldResolve !== 'Yes') {
                console.log('User declined to resolve conflicts');
                await this.gitUtils.execCommand('git cherry-pick --abort');
                return false;
            }
    
            // Wait for actual conflict resolution
            const resolution = await this.waitForConflictResolution(files);
            if (resolution !== 'continue') {
                console.log('User cancelled conflict resolution');
                await this.gitUtils.execCommand('git cherry-pick --abort');
                return false;
            }
    
            // Stage resolved files before checking for remaining conflicts
            await this.gitUtils.execCommand('git add .');
            
            // Give git a moment to process the staging
            await new Promise(resolve => setTimeout(resolve, 500));
    
            // Verify conflicts are actually resolved
            const status = await this.gitUtils.execCommand('git status');
            if (status.includes('You have unmerged paths')) {
                vscode.window.showWarningMessage('There are still unresolved conflicts');
                return false;
            }
    
            // Continue with cherry-pick
            await this.gitUtils.execCommand('git cherry-pick --continue');
            return true;
    
        } catch (error) {
            console.error('Error in conflict resolution:', error);
            await this.gitUtils.execCommand('git cherry-pick --abort');
            return false;
        }
    }

    private async getConflictedFiles(): Promise<string[]> {
        const output = await this.gitUtils.execCommand('git diff --name-only --diff-filter=U');
        return output.split('\n').filter(file => file.trim());
    }

    private async openConflictedFiles(files: string[]): Promise<void> {
            // Open SCM view first
            await vscode.commands.executeCommand('workbench.view.scm');
            
            // Keep track of current extension view
            const extensionView = vscode.window.activeTextEditor;
            
            for (const file of files) {
                try {
                    const uri = vscode.Uri.file(path.join(this.workspaceService.workspacePath, file));
                    const doc = await vscode.workspace.openTextDocument(uri);
                    
                    // Open document in new tab
                    await vscode.window.showTextDocument(doc, {
                        viewColumn: vscode.ViewColumn.Active,
                        preserveFocus: true, // Keep focus on extension
                        preview: false // Open as permanent tab
                    });
                    
                    // Add small delay between file opens
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Failed to open file: ${file}`, error);
                    // Don't throw - continue with remaining files
                }
            }
        
            // Ensure extension view stays active
            if (extensionView) {
                await vscode.window.showTextDocument(extensionView.document, {
                    viewColumn: extensionView.viewColumn,
                    preserveFocus: false
                });
            }
        }

    private async waitForConflictResolution(files: string[]): Promise<'continue' | 'cancel'> {
        const disposables: vscode.Disposable[] = [];
        const watchers: vscode.FileSystemWatcher[] = [];
    
        try {
            return await new Promise((resolve) => {
                let isPromptShowing = false;
                const debounceTime = 1000;
                let debounceTimer: NodeJS.Timeout;
    
                watchers.push(...files.map(file => 
                    vscode.workspace.createFileSystemWatcher(
                        new vscode.RelativePattern(this.workspaceService.workspacePath, file)
                    )
                ));
    
                const showPrompt = async () => {
                    if (isPromptShowing) return;
                    
                    try {
                        isPromptShowing = true;
                        const choice = await vscode.window.showInformationMessage(
                            'Have you resolved all conflicts?',
                            {
                                modal: true,
                                detail: 'Select "Resolved" if you have resolved all conflicts, "Continue Editing" to keep working, or "Abort Cherry-pick" to cancel.'
                            },
                            { title: 'Resolved', isCloseAffordance: false },
                            { title: 'Continue Editing', isCloseAffordance: false },
                            { title: 'Abort Cherry-pick', isCloseAffordance: true }
                        );
                
                        if (choice?.title === 'Resolved') {
                            resolve('continue');
                        } else if (choice?.title === 'Abort Cherry-pick') {
                            resolve('cancel');
                        }
                        // "Continue Editing" does nothing, allowing the user to keep working
                    } catch (error) {
                        console.error('Dialog was canceled:', error);
                        resolve('cancel');
                    } finally {
                        isPromptShowing = false;
                    }
                };
    
                // Add save listener
                disposables.push(
                    vscode.workspace.onDidSaveTextDocument(doc => {
                        if (files.some(f => doc.uri.fsPath.endsWith(f))) {
                            showPrompt();
                        }
                    })
                );
    
                // Add change listeners
                watchers.forEach(watcher => {
                    disposables.push(
                        watcher.onDidChange(() => {
                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(showPrompt, debounceTime);
                        })
                    );
                });
            });
        } finally {
            // Ensure cleanup happens
            disposables.forEach(d => d.dispose());
            watchers.forEach(w => w.dispose());
        }
    }


}