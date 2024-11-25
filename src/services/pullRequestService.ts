import * as vscode from 'vscode';
import { GitUtils } from '../utils/git';
import { RepoService } from '../services/repoService';
import { PRData, VersionPrUrls } from '../types';
import { LanguageService } from './languageService';

export class PullRequestService {
    private validatedRepoName: string;

    constructor(
        private repoName: string,
        private repoService: RepoService,
        private gitUtils: GitUtils,
        private languageService: LanguageService
    ) {
        this.repoName = repoName;
        this.validatedRepoName = '';
    }

    async init(): Promise<void> {
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );
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
            const errorMessage = strings.pr_init_failed.replace('{0}', error.message);
            throw new Error(errorMessage);
        }
    }

    private async handleError(error: any, type: string): Promise<void> {
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );

        const errorMessage = strings[`error_${type}`].replace('{0}', error.message);
        
        const retry = await vscode.window.showErrorMessage(
            errorMessage,
            strings.yes,
            strings.no
        );

        if (retry === strings.no) {
            throw new Error(errorMessage);
        }
    }

    private async validateRepositoryAccess(repoName: string): Promise<string> {
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );
    
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
    
            // Check collaborator permissions
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
    
            throw new Error(strings.pr_invalid_repo_permissions.replace('{0}', repoName));
        } catch (error: any) {
            if (error.message.includes(strings.pr_invalid_repo_permissions.replace('{0}', ''))) {
                throw error;
            }
            throw new Error(strings.pr_validation_failed.replace('{0}', error.message));
        }
    }

    private async formatRepoName(repoName: string): Promise<string> {
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );
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
            const errorMessage = strings.error_repo_name.replace('{0}', error.message);
            throw new Error(errorMessage);
        }
    }

    /**
     * Creates a pull request for a single version.
     * @param prUrl - URL of the original PR.
     * @param newBranch - Name of the new branch.
     * @param version - The version to backport.
     */
    async createPullRequest(prUrl: string, newBranch: string, version: string): Promise<void> {
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        if (!this.validatedRepoName) {
            await this.init();
        }
    
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: strings.pr_creating_title,
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ message: strings.pr_fetching_data, increment: 20 });
                const prData = await this.fetchPullRequestData(prUrl);
    
                progress.report({ message: strings.pr_generating_title, increment: 20 });
                const newPrTitle = `${prData.title} (${version})`;
    
                progress.report({ message: strings.pr_creating, increment: 60 });
                await this.createGitHubPullRequest(newBranch, newPrTitle, prData.body, version);
    
            } catch (error: any) {
                if (token.isCancellationRequested) {
                    vscode.window.showInformationMessage(strings.pr_creation_cancelled);
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
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );
        try {
            // Parse PR URL properly
            const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (!urlMatch) {
                throw new Error(strings.pr_url_invalid);
            }
            
            const [, owner, repo, prNumber] = urlMatch;
            const fullRepoName = `${owner}/${repo}`;
    
            // Ensure we have proper repo format for all subsequent calls
            if (!this.validateRepoFormat(this.repoName)) {
                throw new Error(strings.pr_invalid_repo_format.replace('{0}', this.repoName));
            }
    
            // Validate repo exists
            try {
                await this.gitUtils.execCommand(`gh repo view ${fullRepoName}`);
            } catch (error) {
                throw new Error(strings.pr_repo_not_found.replace('{0}', fullRepoName));
            }
    
            const command = `gh pr view ${prNumber} --repo ${fullRepoName} --json title,body`;
            const prDataRaw = await this.gitUtils.execCommand(command);
            
            try {
                const prData: PRData = JSON.parse(prDataRaw);
                if (!prData.title || !prData.body) {
                    throw new Error(strings.pr_no_title_body);
                }
                return prData;
            } catch (error) {
                throw new Error(strings.pr_parse_error.replace('{0}', (error as any).message));
            }
    
        } catch (error: any) {
            const message = error.message.includes('expected the "[HOST/]OWNER/REPO" format')
                ? strings.pr_invalid_repo_format
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
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        const selection = await vscode.window.showQuickPick(
            [
                { label: strings.pr_self_assign_yes, description: strings.pr_self_assign_yes_desc },
                { label: strings.pr_self_assign_no, description: strings.pr_self_assign_no_desc }
            ],
            { placeHolder: strings.pr_self_assign_prompt }
        );
    
        if (selection?.label === strings.pr_self_assign_yes) {
            return '@self';
        }
    
        const users = await this.fetchGitHubUsers();
        const assignee = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: strings.pr_select_assignee }
        );
    
        return assignee?.label;
    }

    /**
     * Prompts the user to select a reviewer for the PR.
     * @returns The reviewer's username or undefined.
     */
    private async selectReviewer(): Promise<string | undefined> {
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        
        const users = await this.fetchGitHubUsers();
        const reviewer = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: strings.pr_select_reviewer }
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
            await this.handleError(error, 'pr_fetch_github_users');
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
        const strings = this.languageService.getStringsForLanguage(this.languageService.getCurrentLanguage());
        let retrying = true;
        
        while (retrying) {
            try {
                const prUrl = await vscode.window.showInputBox({
                    prompt: strings.pr_url_prompt,
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value) { return strings.pr_url_required; }
                        if (!value.includes('github.com') || !value.includes('/pull/')) {
                            return strings.pr_url_invalid;
                        }
                        return null;
                    }
                });
    
                if (!prUrl) {
                    const retry = await vscode.window.showWarningMessage(
                        strings.pr_url_missing,
                        strings.yes,
                        strings.no
                    );
                    if (retry !== strings.yes) {
                        retrying = false;
                        break;
                    }
                    continue;
                }
    
                await this.createPullRequest(prUrl, newBranch, version);
                retrying = false;
                
            } catch (error: any) {
                const retry = await vscode.window.showErrorMessage(
                    `${error.message}. ${strings.retry_prompt}`,
                    strings.yes,
                    strings.no
                );
                
                if (retry !== strings.yes) {
                    retrying = false;
                    break;
                }
            }
        }
    }

    private validateRepoFormat(repoName: string): boolean {
        // Allow simple repo names to pass initial validation
        return true;
    }
}