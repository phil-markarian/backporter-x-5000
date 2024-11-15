// src/services/pullRequestService.ts
import * as vscode from 'vscode';
import { GitUtils } from '../utils/git';
import { RepoService } from '../services/repoService';
import { PRData, VersionPrUrls } from '../types';

export class PullRequestService {
    constructor(
        private repoName: string,
        private repoService: RepoService,
        private gitUtils: GitUtils
    ) {}

    /**
     * Creates a pull request for a single version.
     * @param prUrl - URL of the original PR.
     * @param newBranch - Name of the new branch.
     * @param version - The version to backport.
     */
    async createPullRequest(prUrl: string, newBranch: string, version: string): Promise<void> {
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

                progress.report({ message: "Fetching version PRs...", increment: 20 });
                const versionPrUrl = await this.fetchVersionPrUrl(version);

                progress.report({ message: "Creating PR...", increment: 40 });
                await this.createGitHubPullRequest(newBranch, newPrTitle, prData.body, versionPrUrl);

            } catch (error: any) {
                if (token.isCancellationRequested) {
                    vscode.window.showInformationMessage('PR creation cancelled');
                    return;
                }
                vscode.window.showErrorMessage(`Failed to create PR: ${error.message}`);
            }
        });
    }

    /**
     * Fetches pull request data from a given PR URL.
     * @param prUrl - URL of the PR.
     * @returns PR data including title and body.
     */
    private async fetchPullRequestData(prUrl: string): Promise<PRData> {
        const urlParts = prUrl.split('/');
        const prNumber = urlParts.pop() || '';
        const repoOwner = urlParts[urlParts.length - 2];
        const command = `gh pr view ${prNumber} --repo ${repoOwner}/${this.repoName} --json title,body`;
        
        const prDataRaw = await this.gitUtils.execCommand(command);
        const prData: PRData = JSON.parse(prDataRaw);
        
        if (!prData.title || !prData.body) {
            throw new Error('Invalid PR data received');
        }
        
        return prData;
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
    private async createGitHubPullRequest(branch: string, title: string, body: string, versionPrUrl: string): Promise<void> {
        const createPRCommand = `gh pr create --repo ${this.repoName} --head ${branch} --title "${title}" --body "${body}" --base main`;
        const prUrl = await this.gitUtils.execCommand(createPRCommand);
        
        const prNumber = prUrl.trim().split('/').pop() || '';
        
        const assignee = await this.handlePRAssignment();
        if (assignee) {
            const assignCommand = assignee === '@self' 
                ? `gh pr edit ${prNumber} --add-assignee "@me"` 
                : `gh pr edit ${prNumber} --add-assignee "${assignee.substring(1)}"`;
            await this.gitUtils.execCommand(assignCommand);
        }

        const reviewer = await this.selectReviewer();
        if (reviewer) {
            await this.gitUtils.execCommand(`gh pr edit ${prNumber} --add-reviewer "${reviewer.substring(1)}"`);
        }

        // Optionally, you can link back the version PR URL here if needed
        // Example: Add a comment or update PR with versionPrUrl
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
        const org = this.repoName.split('/')[0];
        const command = `gh api /orgs/${org}/members --jq '.[].login'`;
        const usersRaw = await this.gitUtils.execCommand(command);
        const users = usersRaw.split('\n').filter(user => user.trim() !== '');
        return users;
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
}