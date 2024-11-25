import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from '../utils/git';
import { WorkspaceService } from './workspaceService';
import { StateService } from './stateService';
import { LanguageService } from './languageService';

export class GitBranchService {
    private workspaceService: WorkspaceService;

    constructor(private readonly gitUtils: GitUtils,
                private readonly stateService: StateService,
                private readonly languageService: LanguageService
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

    private async handleBranchCreationError(error: any, newBranch: string, originalBranch: string): Promise<void> {
        console.error('Branch creation failed:', error);
        
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        // Categorize error type
        let errorMessage = strings.error_unknown;
        if (error.message.includes('already exists')) {
            errorMessage = strings.error_branch_exists.replace('{0}', newBranch);
        } else if (error.message.includes('Permission denied')) {
            errorMessage = strings.error_permission_denied;
        } else if (error.message.includes('could not apply')) {
            errorMessage = strings.error_cherry_pick_failed;
        } else if (error.message.includes('not found')) {
            errorMessage = strings.error_not_found;
        } else if (error.message.includes('network')) {
            errorMessage = strings.error_network;
        }
    
        // Always try to cleanup
        await this.cleanupAndRestore(newBranch, originalBranch);
        vscode.window.showErrorMessage(strings.error_branch_creation_failed.replace('{0}', errorMessage));
    }


    private async handleExistingBranch(branchName: string): Promise<string | null> {
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        // Check if branch exists both locally and remotely
        try {
            const localExists = await this.gitUtils.branchExists(branchName);
            const remoteExists = await this.gitUtils.remoteBranchExists(branchName);
    
            if (!localExists && !remoteExists) {
                return null;
            }
    
            // Show warning with options
            const choice = await vscode.window.showWarningMessage(
                strings.branch_exists_message.replace('{0}', branchName),
                {
                    modal: true,
                    detail: `${strings.branch_exists_title}${remoteExists ? ' (local + remote)' : ' (local only)'}`
                },
                {
                    title: strings.branch_auto_rename,
                    description: strings.branch_auto_rename_desc,
                    action: 'autoRename'
                },
                {
                    title: strings.branch_delete_recreate,
                    description: strings.branch_delete_recreate_desc,
                    action: 'deleteRecreate'
                },
                {
                    title: strings.branch_cancel,
                    description: strings.branch_cancel_desc,
                    action: 'cancel',
                    isCloseAffordance: true
                }
            );
    
            if (choice?.action === 'deleteRecreate') {
                // Delete both local and remote branches if they exist
                if (localExists) {
                    await this.gitUtils.execCommand(`git branch -D ${branchName}`);
                }
                if (remoteExists) {
                    await this.gitUtils.execCommand(`git push origin --delete ${branchName}`);
                }
                return null; // Allow branch creation
            }
    
            return choice?.action || 'cancel';
        } catch (error) {
            console.error(`Error handling existing branch: ${error}`);
            return 'cancel';
        }
    }

    private async handleCherryPickConflict(branchName: string): Promise<boolean> {
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
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
    
            const response = await vscode.window.showWarningMessage(
                strings.conflict_resolve_message,
                { modal: true, detail: strings.conflict_resolve_title },
                strings.yes,
                strings.no
            );
    
            if (response === strings.yes) {
                await this.openConflictedFiles(conflictedFiles);
                const resolved = await this.resolveConflicts(conflictedFiles);
                
                if (!resolved) {
                    // Silently abort without throwing error
                    try {
                        await this.gitUtils.execCommand('git cherry-pick --abort');
                    } catch (error) {
                        // Ignore abort errors
                    }
                    
                    await this.stateService.updateCherryPickState({
                        inProgress: false,
                        hasConflicts: false
                    });
                    
                    return false;
                }
                return true;
            }
    
            // User chose not to resolve conflicts
            await this.gitUtils.execCommand('git cherry-pick --abort');
            await this.stateService.updateCherryPickState({
                inProgress: false,
                hasConflicts: false
            });
            return false;
    
        } catch (error) {
            console.error('Error handling cherry-pick conflict:', error);
            await this.stateService.updateCherryPickState({
                inProgress: false,
                hasConflicts: false
            });
            return false;
        }
    }
    
    private async resolveConflicts(files: string[]): Promise<boolean> {
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        try {
            console.log('Opening conflicted files:', files);
            await this.openConflictedFiles(files);
    
            // First ask if user wants to resolve conflicts
            const shouldResolve = await vscode.window.showInformationMessage(
                strings.resolve_conflicts_prompt,
                { modal: true, detail: strings.resolve_conflicts_title },
                strings.yes,
                strings.no
            );
    
            if (shouldResolve !== strings.yes) {
                console.log('User declined to resolve conflicts');
                await this.gitUtils.execCommand('git cherry-pick --abort');
                return false;
            }
    
            return await this.waitForConflictResolution(files) === 'continue';
        } catch (error) {
            console.error('Error resolving conflicts:', error);
            try {
                await this.gitUtils.execCommand('git cherry-pick --abort');
            } catch (abortError) {
                // Ignore abort errors
            }
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
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        try {
            const choice = await vscode.window.showInformationMessage(
                strings.conflict_resolution_prompt,
                { modal: true, detail: strings.conflict_resolution_detail },
                strings.conflict_resolved,
                strings.conflict_continue_editing,
                strings.conflict_abort
            );
    
            if (choice === strings.conflict_resolved) {
                const remainingConflicts = await this.getConflictedFiles();
                if (remainingConflicts.length > 0) {
                    await this.openConflictedFiles(remainingConflicts);
                    return await this.waitForConflictResolution(remainingConflicts);
                }
    
                try {
                    await this.gitUtils.execCommand('git cherry-pick --continue');
                    await this.stateService.updateCherryPickState({
                        inProgress: false,
                        hasConflicts: false
                    });
                    return 'continue';
                } catch (error) {
                    console.error('Error continuing cherry-pick:', error);
                    return 'cancel';
                }
            }
    
            if (choice === strings.conflict_continue_editing) {
                await this.openConflictedFiles(files);
                return await this.waitForConflictResolution(files);
            }
    
            // User chose to abort or dialog was dismissed
            try {
                await this.gitUtils.execCommand('git cherry-pick --abort');
            } catch (error) {
                // Ignore abort errors
            }
    
            await this.stateService.updateCherryPickState({
                inProgress: false,
                hasConflicts: false
            });
            return 'cancel';
        } catch (error) {
            console.error('Error in conflict resolution:', error);
            try {
                await this.gitUtils.execCommand('git cherry-pick --abort');
            } catch (abortError) {
                // Ignore abort errors
            }
            await this.stateService.updateCherryPickState({
                inProgress: false,
                hasConflicts: false
            });
            return 'cancel';
        }
    }


}