import { exec } from 'child_process';
import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';

export class GitUtils {
    constructor(private readonly workspaceService: WorkspaceService) {}

    async execCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const workspacePath = this.workspaceService.workspacePath;
    
                // Only log non-sensitive commands
                if (!command.includes('--abort')) {
                    console.log({ command, workspacePath });
                }
    
                exec(command, { 
                    cwd: workspacePath,
                    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
                }, (error, stdout, stderr) => {
                    if (error) {
                        // Check for expected error cases
                        const expectedErrors = [
                            'no cherry-pick or revert in progress',
                            'could not apply',
                            'needs merge',
                            'hint: run "git cherry-pick --abort"'
                        ];
    
                        const isExpectedError = expectedErrors.some(msg => 
                            stderr.includes(msg) || command.includes('cherry-pick')
                        );
    
                        if (!isExpectedError) {
                            console.error('Command execution failed:', { error: error.message, stderr });
                        }
    
                        const err = new Error(`Command failed: ${stderr || error.message}`);
                        (err as any).stderr = stderr;
                        reject(err);
                        return;
                    }
                    
                    // Only log output for non-abort commands
                    if (!command.includes('--abort')) {
                        console.log('Command output:', stdout);
                    }
                    resolve(stdout.trim());
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async checkIfMergeCommit(commitHash: string): Promise<boolean> {
        try {
            const parents = await this.execCommand(`git rev-list --parents -n 1 ${commitHash}`);
            const parentHashes = parents.trim().split(' ');
            return parentHashes.length > 2;
        } catch (error) {
            console.error('Error checking if commit is a merge commit:', error);
            return false;
        }
    }

    async validateGitRepo(): Promise<boolean> {
        try {
            console.log('Validating git repository...');
            console.log('Current workspace:', this.workspaceService.workspacePath);
            
            const gitStatus = await this.execCommand('git status');
            console.log('Git status:', gitStatus);
            
            return true;
        } catch (error) {
            console.error('Git validation error:', error);
            vscode.window.showErrorMessage(`Git validation failed: ${error}`);
            return false;
        }
    }

    async localBranchExists(branchName: string): Promise<boolean> {
        try {
            const cleanBranchName = this.normalizeBranchName(branchName);
            const localBranches = await this.execCommand('git branch --list');
            const exists = localBranches
                .split('\n')
                .map(b => b.replace('*', '').trim())
                .some(b => b === cleanBranchName);
    
            console.log('Local branch check:', {
                branchName,
                cleanBranchName,
                exists
            });
    
            return exists;
        } catch (error) {
            console.error('Error checking local branch:', error);
            return false;
        }
    }
    
    async remoteBranchExists(branchName: string): Promise<boolean> {
        try {
            const cleanBranchName = this.normalizeBranchName(branchName);
            const remoteBranches = await this.execCommand('git branch -r --list');
            const exists = remoteBranches
                .split('\n')
                .map(b => b.trim().replace('origin/', ''))
                .some(b => b === cleanBranchName);
    
            console.log('Remote branch check:', {
                branchName,
                cleanBranchName,
                exists
            });
    
            return exists;
        } catch (error) {
            console.error('Error checking remote branch:', error);
            return false;
        }
    }
    
    async branchExists(branchName: string, checkRemote: boolean = true): Promise<boolean> {
        const [localExists, remoteExists] = await Promise.all([
            this.localBranchExists(branchName),
            checkRemote ? this.remoteBranchExists(branchName) : Promise.resolve(false)
        ]);
    
        console.log('Branch existence check:', {
            branchName,
            localExists,
            remoteExists,
            checkRemote
        });
    
        return localExists || (checkRemote && remoteExists);
    }
    
    private normalizeBranchName(branchName: string): string {
        return branchName
            .replace('refs/heads/', '')
            .replace('refs/remotes/origin/', '')
            .replace('origin/', '')
            .trim();
    }

    async getBranchNameFromCommit(commitHash: string): Promise<string> {
        try {
            const commitMsg = await this.execCommand(`git log -1 --pretty=format:%s ${commitHash}`);
            const mergePRMatch = commitMsg.match(/Merge pull request #\d+ from [\w-]+\/([\w\/-]+)/);
            
            if (mergePRMatch) {
                return mergePRMatch[1];
            }

            const branchName = await this.execCommand(`git name-rev --name-only ${commitHash}`);
            return branchName.trim()
                .replace('remotes/origin/', '')
                .replace('tags/', '')
                .split('~')[0]
                .split('^')[0];
        } catch (error) {
            console.error('Error getting branch name:', error);
            return 'cherry-pick';
        }
    }
}