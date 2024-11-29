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

    async remoteBranchExists(branchName: string): Promise<boolean> {
        try {
            const cleanBranchName = this.normalizeBranchName(branchName);
            const remoteCheck = await this.execCommand(`git ls-remote --heads origin ${cleanBranchName}`)
                .then(output => output.length > 0)
                .catch(() => false);
    
            console.log('Remote branch check:', {
                branchName,
                cleanBranchName,
                exists: remoteCheck,
                method: 'ls-remote'
            });
    
            return remoteCheck;
        } catch (error) {
            console.error('Error checking remote branch:', error);
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
                exists,
                branches: localBranches.split('\n').map(b => b.trim())
            });
    
            return exists;
        } catch (error) {
            console.error('Error checking local branch:', error);
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

    async getCurrentBranch(): Promise<string> {
        try {
            const branchName = await this.execCommand('git rev-parse --abbrev-ref HEAD');
            const cleanBranchName = this.normalizeBranchName(branchName);
            
            console.log('Current branch check:', {
                original: branchName,
                normalized: cleanBranchName
            });
            
            return cleanBranchName;
        } catch (error) {
            console.error('Error getting current branch:', error);
            throw new Error('Failed to get current branch');
        }
    }

    async abortCherryPick(): Promise<void> {
        try {
            await this.execCommand('git cherry-pick --abort');
            console.log('Cherry-pick abort successful');
        } catch (error) {
            // Don't throw since abort is typically called in cleanup scenarios
            console.error('Error aborting cherry-pick:', error);
        }
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
    
    async checkout(branch: string): Promise<void> {
        await this.execCommand(`git checkout ${branch}`);
    }
    
    async createBranch(branchName: string): Promise<void> {
        await this.execCommand(`git checkout -b ${branchName}`);
    }
    
    async cherryPick(commitHash: string, isMergeCommit: boolean = false): Promise<void> {
        const cmd = isMergeCommit 
            ? `git cherry-pick -m 1 ${commitHash}`
            : `git cherry-pick ${commitHash}`;
        await this.execCommand(cmd);
    }
    
    async fetchAll(): Promise<void> {
        await this.execCommand('git fetch --all');
    }
    
    async push(branch: string): Promise<void> {
        await this.execCommand(`git push -u origin ${branch}`);
    }
    
    async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
        const flag = force ? '-D' : '-d';
        await this.execCommand(`git branch ${flag} ${branchName}`);
    }
    
    async deleteRemoteBranch(branchName: string): Promise<void> {
        await this.execCommand(`git push origin --delete ${branchName}`);
    }
    
    async resetHard(): Promise<void> {
        await this.execCommand('git reset --hard');
    }
    
    async addAll(): Promise<void> {
        await this.execCommand('git add .');
    }

    async getRemoteUrl(): Promise<string> {
        try {
            return await this.execCommand('git remote get-url origin');
        } catch (error) {
            console.error('Error getting remote URL:', error);
            throw new Error('Failed to get remote URL');
        }
    }
    
    async cherryPickContinue(): Promise<void> {
        await this.execCommand('git cherry-pick --continue');
    }
    
    async getStatus(): Promise<string> {
        return this.execCommand('git status');
    }
    
    async validateCommitExists(commitHash: string): Promise<boolean> {
        return this.execCommand(`git cat-file -t ${commitHash}`)
            .then(() => true)
            .catch(() => false);
    }

    async getConflictedFiles(): Promise<string[]> {
        const output = await this.execCommand('git diff --name-only --diff-filter=U');
        return output.split('\n').filter(file => file.trim());
    }

    async viewRepo(repoName: string): Promise<void> {
        await this.execCommand(`gh repo view ${repoName}`);
    }
    
    async getCurrentUser(): Promise<string> {
        return this.execCommand('gh api user --jq .login');
    }
    
    async getCollaboratorPermission(repoName: string, username: string): Promise<string> {
        const cmd = `gh api repos/${repoName}/collaborators/${username.trim()}/permission --jq .permission`;
        return this.execCommand(cmd);
    }
    
    async getOrgMembership(org: string, username: string): Promise<string> {
        const cmd = `gh api orgs/${org}/memberships/${username.trim()} --jq .state`;
        return this.execCommand(cmd);
    }
    
    async getPrData(prNumber: string, repoName: string): Promise<string> {
        const cmd = `gh pr view ${prNumber} --repo ${repoName} --json title,body`;
        return this.execCommand(cmd);
    }
    
    async createPr(options: {
        repo: string,
        head: string,
        base: string,
        title: string,
        body: string
    }): Promise<string> {
        const cmd = `gh pr create --repo ${options.repo} \
            --head ${options.head} \
            --base ${options.base} \
            --title "${options.title}" \
            --body "${options.body}"`;
        return this.execCommand(cmd);
    }
    
    async editPr(options: {
        number: string,
        repo: string,
        assignee?: string,
        reviewer?: string
    }): Promise<void> {
        if (options.assignee) {
            const assignCmd = options.assignee === '@self'
                ? `gh pr edit ${options.number} --repo ${options.repo} --add-assignee "@me"`
                : `gh pr edit ${options.number} --repo ${options.repo} --add-assignee "${options.assignee.substring(1)}"`;
            await this.execCommand(assignCmd);
        }
        
        if (options.reviewer) {
            await this.execCommand(
                `gh pr edit ${options.number} --repo ${options.repo} --add-reviewer "${options.reviewer.substring(1)}"`
            );
        }
    }
    
    async listPrs(options: {
        repo: string,
        state?: string,
        head?: string,
        search?: string,
        format?: string
    }): Promise<string> {
        let cmd = `gh pr list --repo ${options.repo}`;
        if (options.state) {cmd += ` --state ${options.state}`;}
        if (options.head) {cmd += ` --head ${options.head}`;}
        if (options.search) {cmd += ` --search "${options.search}"`;}
        if (options.format) {cmd += ` --json ${options.format}`;}
        return this.execCommand(cmd);
    }
    
    async getRepoCollaborators(repoName: string): Promise<string[]> {
        const command = `gh api repos/${repoName}/collaborators --jq '.[].login'`;
        const output = await this.execCommand(command);
        return output.split('\n').filter(user => user.trim());
    }
    
    async getOrgMembers(org: string): Promise<string[]> {
        const command = `gh api orgs/${org}/members --jq '.[].login'`;
        const output = await this.execCommand(command);
        return output.split('\n').filter(user => user.trim());
    }

    async validatePrUrl(prUrl: string): Promise<boolean> {
        try {
            const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (!urlMatch) {
                return false;
            }
            
            const [, owner, repo, prNumber] = urlMatch;
            const fullRepoName = `${owner}/${repo}`;
            
            // Check if PR exists using GitHub CLI
            await this.execCommand(`gh pr view ${prNumber} --repo ${fullRepoName}`);
            return true;
        } catch (error) {
            console.error('Error validating PR URL:', error);
            return false;
        }
    }
}