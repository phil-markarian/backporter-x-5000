import { exec } from 'child_process';
import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';

export class GitUtils {
    constructor(private readonly workspaceService: WorkspaceService) {}

    async execCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const workspacePath = this.workspaceService.workspacePath;

                console.log({
                    command,
                    workspacePath,
                    pwd: require('child_process').execSync('pwd', { cwd: workspacePath }).toString()
                });

                exec(command, { 
                    cwd: workspacePath,
                    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
                }, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Command execution failed:', { error: error.message, stderr });
                        reject(new Error(`Command failed: ${error.message}`));
                        return;
                    }
                    console.log('Command output:', stdout);
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

    async branchExists(branchName: string): Promise<boolean> {
        try {
            await this.execCommand(`git rev-parse --verify ${branchName}`);
            return true;
        } catch {
            try {
                await this.execCommand(`git rev-parse --verify origin/${branchName}`);
                return true;
            } catch {
                return false;
            }
        }
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