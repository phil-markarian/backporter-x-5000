// src/services/pullRequestService.ts
import * as vscode from 'vscode';
import { GitUtils } from '../utils/git';
import { RepoService } from '../services/repoService';
import { PRData, VersionPrUrls } from '../types';

export class PullRequestService {
    private validatedRepoName: string;

    constructor(
        private repoName: string,
        private repoService: RepoService,
        private gitUtils: GitUtils
    ) {
        this.repoName = repoName;
        this.validatedRepoName = '';
    }

    async init(): Promise<void> {
        try {
            // For simple repo names, get owner from git remote
            if (!this.repoName.includes('/')) {
                const remoteUrl = await this.gitUtils.execCommand('git remote get-url origin');
                const owner = remoteUrl.includes('git@github.com:')
                    ? remoteUrl.split(':')[1].split('/')[0]
                    : remoteUrl.replace('https://github.com/', '').split('/')[0];

                const fullRepoName = `${owner.replace('.git', '').trim()}/${this.repoName}`;
                this.validatedRepoName = await this.validateRepositoryAccess(fullRepoName);
                return;
            }

            // Already in owner/repo format or GitHub URL
            this.validatedRepoName = await this.validateRepositoryAccess(this.repoName);
        } catch (error: any) {
            throw new Error(`Repository initialization failed: ${error.message}`);
        }
    }

    private async validateRepositoryAccess(repoName: string): Promise<string> {
        try {
            // Check if repo exists
            await this.gitUtils.execCommand(`gh repo view ${repoName}`);
            
            // Get current user
            const currentUser = await this.gitUtils.execCommand('gh api user --jq .login');
            const [owner] = repoName.split('/');
            
            // User is owner
            if (owner.trim() === currentUser.trim()) {
                return repoName;
            }
    
            // Check org membership/collaborator status
            try {
                const collaboratorCmd = `gh api repos/${repoName}/collaborators/${currentUser.trim()}/permission --jq .permission`;
                const permission = await this.gitUtils.execCommand(collaboratorCmd);
                
                if (['admin', 'write', 'maintain'].some(level => permission.includes(level))) {
                    return repoName;
                }
            } catch {
                // Try org membership if collaborator check fails
                const [org] = repoName.split('/');
                const orgMemberCmd = `gh api orgs/${org}/memberships/${currentUser.trim()} --jq .state`;
                const memberStatus = await this.gitUtils.execCommand(orgMemberCmd);
                
                if (memberStatus.includes('active')) {
                    return repoName;
                }
            }
    
            throw new Error(`Insufficient permissions for repository ${repoName}`);
        } catch (error: any) {
            if (error.message.includes('Insufficient permissions')) {
                throw error;
            }
            throw new Error(`Repository validation failed: ${error.message}`);
        }
    }

    private async formatRepoName(repoName: string): Promise<string> {
        // If it's a full PR URL, extract repo info
        if (repoName.includes('github.com')) {
            const urlMatch = repoName.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (urlMatch) {
                const [, owner, repo] = urlMatch;
                return await this.validateRepositoryAccess(`${owner}/${repo.replace(/\/pull\/\d+$/, '')}`);
            }
        }
    
        // If already in owner/repo format
        if (repoName.includes('/')) {
            return await this.validateRepositoryAccess(repoName);
        }
    
        try {
            // Get remote URL to determine owner
            const remoteUrl = await this.gitUtils.execCommand('git remote get-url origin');
            
            // Extract owner from different git URL formats
            let owner;
            if (remoteUrl.includes('git@github.com:')) {
                // SSH format: git@github.com:owner/repo.git
                owner = remoteUrl.split(':')[1].split('/')[0];
            } else {
                // HTTPS format: https://github.com/owner/repo.git
                owner = remoteUrl
                    .replace('https://github.com/', '')
                    .split('/')[0];
            }
    
            owner = owner.replace('.git', '').trim();
            return await this.validateRepositoryAccess(`${owner}/${repoName}`);
        } catch (error: any) {
            throw new Error(`Could not determine repository owner: ${error.message}`);
        }
    }

    /**
     * Creates a pull request for a single version.
     * @param prUrl - URL of the original PR.
     * @param newBranch - Name of the new branch.
     * @param version - The version to backport.
     */
    async createPullRequest(prUrl: string, newBranch: string, version: string): Promise<void> {
        if (!this.validatedRepoName) {
            await this.init();
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Creating Pull Request",
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ message: "Fetching PR data...", increment: 20 });
                const prData = await this.fetchPullRequestData(prUrl);

                progress.report({ message: "Generating title...", increment: 20 });
                const newPrTitle = `${prData.title} (${version})`;

                progress.report({ message: "Creating PR...", increment: 60 });
                await this.createGitHubPullRequest(newBranch, newPrTitle, prData.body, version);

            } catch (error: any) {
                if (token.isCancellationRequested) {
                    vscode.window.showInformationMessage('PR creation cancelled');
                    return;
                }
                throw error;
            }
        });
    }

    /**
     * Fetches pull request data from a given PR URL.
     * @param prUrl - URL of the PR.
     * @returns PR data including title and body.
     */
    private async fetchPullRequestData(prUrl: string): Promise<PRData> {
        try {
            // Parse PR URL properly
            const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (!urlMatch) {
                throw new Error('Invalid GitHub PR URL format');
            }
            
            const [, owner, repo, prNumber] = urlMatch;
            const fullRepoName = `${owner}/${repo}`;
    
            // Ensure we have proper repo format for all subsequent calls
            if (!this.validateRepoFormat(this.repoName)) {
                throw new Error(`Invalid repository format. Expected "owner/repo", got "${this.repoName}"`);
            }
    
            // Validate repo exists
            try {
                await this.gitUtils.execCommand(`gh repo view ${fullRepoName}`);
            } catch (error) {
                throw new Error(`Repository ${fullRepoName} not found or inaccessible`);
            }
    
            const command = `gh pr view ${prNumber} --repo ${fullRepoName} --json title,body`;
            const prDataRaw = await this.gitUtils.execCommand(command);
            
            try {
                const prData: PRData = JSON.parse(prDataRaw);
                if (!prData.title || !prData.body) {
                    throw new Error('Invalid PR data received');
                }
                return prData;
            } catch (error) {
                throw new Error(`Failed to parse PR data: ${(error as any).message}`);
            }
    
        } catch (error: any) {
            const message = error.message.includes('expected the "[HOST/]OWNER/REPO" format') 
                ? 'Repository must be in the format "owner/repo"'
                : error.message;
            throw new Error(message);
        }
    }

    /**
     * Fetches the URL of the PR associated with a specific version.
     * @param version - The version for which to fetch the PR URL.
     * @returns URL of the version-specific PR.
     */
    private async fetchVersionPrUrl(version: string): Promise<string> {
        const command = `gh pr list --repo ${this.repoName} --state closed --head ${version} --json url --jq '.[0].url'`;
        const url = await this.gitUtils.execCommand(command);
        
        if (!url) {
            throw new Error(`No PR found for version ${version}`);
        }
        
        return url.trim();
    }

    /**
     * Creates a GitHub pull request with the provided details.
     * @param branch - Name of the new branch.
     * @param title - Title of the new PR.
     * @param body - Body/description of the new PR.
     * @param versionPrUrl - URL of the version-specific PR.
     */
    private async createGitHubPullRequest(branch: string, title: string, body: string, version: string): Promise<void> {
        try {
            // First push the branch to remote
            await this.gitUtils.execCommand(`git push origin ${branch}`);
            
            // Wait a moment for GitHub to register the push
            await new Promise(resolve => setTimeout(resolve, 1000));
    
            // Verify branch exists remotely
            const remoteBranches = await this.gitUtils.execCommand('git branch -r');
            if (!remoteBranches.includes(`origin/${branch}`)) {
                throw new Error(`Failed to push branch ${branch} to remote`);
            }
    
            // Get default branch for base
            const baseBranch = await this.gitUtils.execCommand('git remote show origin | grep "HEAD branch" | cut -d: -f2').then(b => b.trim());
            
            // Create PR with explicit base and head
            const createPRCommand = `gh pr create --repo ${this.validatedRepoName} \
                --head ${branch} \
                --base ${version} \
                --title "${title}" \
                --body "${body}"`;
                
            const prUrl = await this.gitUtils.execCommand(createPRCommand);
            
            // Handle PR assignment and reviewers
            const prNumber = prUrl.trim().split('/').pop() || '';
            
            if (prNumber) {
                const assignee = await this.handlePRAssignment();
                if (assignee) {
                    const assignCmd = assignee === '@self' 
                        ? `gh pr edit ${prNumber} --repo ${this.validatedRepoName} --add-assignee "@me"` 
                        : `gh pr edit ${prNumber} --repo ${this.validatedRepoName} --add-assignee "${assignee.substring(1)}"`;
                    await this.gitUtils.execCommand(assignCmd);
                }
    
                const reviewer = await this.selectReviewer();
                if (reviewer) {
                    await this.gitUtils.execCommand(
                        `gh pr edit ${prNumber} --repo ${this.validatedRepoName} --add-reviewer "${reviewer.substring(1)}"`
                    );
                }
            }
        } catch (error: any) {
            throw new Error(`Command failed: ${error.stderr || error.message}`);
        }
    }

    /**
     * Handles the assignment of the PR to a user.
     * @returns The assignee's username or undefined.
     */
    private async handlePRAssignment(): Promise<string | undefined> {
        const selection = await vscode.window.showQuickPick(
            [
                { label: 'Yes', description: 'Assign PR to myself' },
                { label: 'No', description: 'Assign PR to someone else' }
            ],
            { placeHolder: 'Self-assign PR?' }
        );

        if (selection?.label === 'Yes') {
            return '@self';
        }

        const users = await this.fetchGitHubUsers();
        const assignee = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: 'Select assignee' }
        );

        return assignee?.label;
    }

    /**
     * Prompts the user to select a reviewer for the PR.
     * @returns The reviewer's username or undefined.
     */
    private async selectReviewer(): Promise<string | undefined> {
        const users = await this.fetchGitHubUsers();
        const reviewer = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: 'Select reviewer' }
        );
        return reviewer?.label;
    }

    /**
     * Fetches GitHub users from the organization.
     * @returns Array of GitHub usernames.
     */
    private async fetchGitHubUsers(): Promise<string[]> {
        try {
            const [owner] = this.validatedRepoName.split('/');
            
            // Get current user to check if it's a personal repo
            const currentUser = await this.gitUtils.execCommand('gh api user --jq .login');
            const isPersonalRepo = owner.trim() === currentUser.trim();
    
            if (isPersonalRepo) {
                // For personal repos, just get collaborators and owner
                const command = `gh api repos/${this.validatedRepoName}/collaborators --jq '.[].login'`;
                const collaborators = await this.gitUtils.execCommand(command);
                const users = new Set([
                    currentUser.trim(),
                    ...collaborators.split('\n').filter(user => user.trim())
                ]);
                return Array.from(users);
            } else {
                // For org repos, get both org members and collaborators
                try {
                    const [orgMembers, collaborators] = await Promise.all([
                        this.gitUtils.execCommand(`gh api orgs/${owner}/members --jq '.[].login'`),
                        this.gitUtils.execCommand(`gh api repos/${this.validatedRepoName}/collaborators --jq '.[].login'`)
                    ]);
    
                    const users = new Set([
                        ...orgMembers.split('\n'),
                        ...collaborators.split('\n')
                    ].filter(user => user.trim()));
    
                    return Array.from(users);
                } catch (error) {
                    // Fallback to just collaborators if org access fails
                    const collaborators = await this.gitUtils.execCommand(
                        `gh api repos/${this.validatedRepoName}/collaborators --jq '.[].login'`
                    );
                    return collaborators.split('\n').filter(user => user.trim());
                }
            }
        } catch (error) {
            console.error('Error fetching GitHub users:', error);
            return [];
        }
    }

    /**
     * Retrieves PR data associated with a specific commit.
     * @param commitHash - The commit hash to search for.
     * @param repoName - Name of the repository.
     * @returns PR data or null if not found.
     */
    private async getPRFromCommit(commitHash: string, repoName: string): Promise<PRData | null> {
        try {
            const fullRepoName = await this.repoService.getFullRepoName(repoName);
            const command = `gh pr list --repo ${fullRepoName} --state all --search "${commitHash}" --json number,title,body --jq '.[0]'`;
            const output = await this.gitUtils.execCommand(command);
            return JSON.parse(output);
        } catch (error) {
            console.error("Error getting PR from commit:", error);
            return null;
        }
    }

    /**
     * Prompts the user to provide a PR URL with retry logic.
     * @param repoName - Name of the repository.
     * @param newBranch - Name of the new branch.
     * @param version - The version to backport.
     */
    public async getPRUrlWithRetry(repoName: string, newBranch: string, version: string): Promise<void> {
        let retrying = true;
        
        while (retrying) {
            try {
                const prUrl = await vscode.window.showInputBox({
                    prompt: 'Please provide the URL of the original PR:',
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value) { return 'PR URL is required'; }
                        if (!value.includes('github.com') || !value.includes('/pull/')) {
                            return 'Invalid GitHub PR URL format';
                        }
                        return null;
                    }
                });

                if (!prUrl) {
                    const retry = await vscode.window.showWarningMessage(
                        'No PR URL provided. Would you like to try again?',
                        'Yes',
                        'No'
                    );
                    if (retry !== 'Yes') {
                        retrying = false;
                        break;
                    }
                    continue;
                }

                await this.createPullRequest(prUrl, newBranch, version);
                retrying = false;
                
            } catch (error: any) {
                const retry = await vscode.window.showErrorMessage(
                    `${error.message}. Would you like to try again?`,
                    'Yes',
                    'No'
                );
                
                if (retry !== 'Yes') {
                    retrying = false;
                    break;
                }
                // Continue loop to retry
            }
        }
    }

    private validateRepoFormat(repoName: string): boolean {
        // Allow simple repo names to pass initial validation
        return true;
    }
}