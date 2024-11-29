import * as vscode from 'vscode';
import { GitUtils } from '../utils/git';
import { PRData } from '../types';
import { LanguageService } from './languageService';

export class PullRequestService {
    private validatedRepoName: string;
    private strings: any;

    constructor(
        private repoName: string,
        private gitUtils: GitUtils,
        private languageService: LanguageService
    ) {
        this.repoName = repoName;
        this.validatedRepoName = '';
        this.strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );
    }

    async init(): Promise<void> {
        try {
            // Let RepoService handle both simple and full repo names
            const fullRepoName = await this.gitUtils.getFullRepoName(this.repoName);

            // Validate access after getting full name
            this.validatedRepoName = await this.validateRepositoryAccess(fullRepoName);
        } catch (error: any) {
            const errorMessage = this.strings.pr_init_failed.replace('{0}', error.message);
            throw new Error(errorMessage);
        }
    }

    private async validateRepositoryAccess(repoName: string): Promise<string> {
        try {
            // Check if repo exists
            await this.gitUtils.viewRepo(repoName);
            
            // Get current user
            const currentUser = await this.gitUtils.getCurrentUser();
            const [owner] = repoName.split('/');
            
            // User is owner
            if (owner.trim() === currentUser.trim()) {
                return repoName;
            }
    
            // Check collaborator permissions
            try {
                const permission = await this.gitUtils.getCollaboratorPermission(repoName, currentUser.trim());
                if (['admin', 'write', 'maintain'].some(level => permission.includes(level))) {
                    return repoName;
                }
            } catch {
                // Try org membership if collaborator check fails
                const [org] = repoName.split('/');
                const memberStatus = await this.gitUtils.getOrgMembership(org, currentUser.trim());
                if (memberStatus.includes('active')) {
                    return repoName;
                }
            }
    
            throw new Error(this.strings.pr_invalid_repo_permissions.replace('{0}', repoName));
        } catch (error: any) {
            if (error.message.includes(this.strings.pr_invalid_repo_permissions.replace('{0}', ''))) {
                throw error;
            }
            throw new Error(this.strings.pr_validation_failed.replace('{0}', error.message));
        }
    }

    async createPullRequest(prUrl: string, newBranch: string, version: string): Promise<void> {
        if (!this.validatedRepoName) {
            await this.init();
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: this.strings.pr_creating_title,
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ message: this.strings.pr_fetching_data, increment: 20 });
                const prData = await this.fetchPullRequestData(prUrl);

                progress.report({ message: this.strings.pr_generating_title, increment: 20 });
                const newPrTitle = `${prData.title} (${version})`;

                progress.report({ message: this.strings.pr_creating, increment: 60 });
                await this.createGitHubPullRequest(newBranch, newPrTitle, prData.body, version);

            } catch (error: any) {
                if (token.isCancellationRequested) {
                    vscode.window.showInformationMessage(this.strings.pr_creation_cancelled);
                    return;
                }
                throw error;
            }
        });
    }

    private async fetchPullRequestData(prUrl: string): Promise<PRData> {
        try {
            const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (!urlMatch) {
                throw new Error(this.strings.pr_url_invalid);
            }
            
            const [, owner, repo, prNumber] = urlMatch;
            const fullRepoName = `${owner}/${repo}`;
    
            if (!this.validateRepoFormat(this.repoName)) {
                throw new Error(this.strings.pr_invalid_repo_format.replace('{0}', this.repoName));
            }
    
            await this.gitUtils.viewRepo(fullRepoName);
            const prDataRaw = await this.gitUtils.getPrData(prNumber, fullRepoName);
            
            try {
                const prData: PRData = JSON.parse(prDataRaw);
                if (!prData.title || !prData.body) {
                    throw new Error(this.strings.pr_no_title_body);
                }
                return prData;
            } catch (error) {
                throw new Error(this.strings.pr_parse_error.replace('{0}', (error as any).message));
            }
    
        } catch (error: any) {
            const message = error.message.includes('expected the "[HOST/]OWNER/REPO" format')
                ? this.strings.pr_invalid_repo_format
                : error.message;
            throw new Error(message);
        }
    }

    private async createGitHubPullRequest(
        branch: string, 
        title: string, 
        body: string, 
        version: string
    ): Promise<void> {
        try {
            // First push the branch to remote
            await this.gitUtils.push(branch);
            
            // Wait a moment for GitHub to register the push
            await new Promise(resolve => setTimeout(resolve, 1000));
    
            // Create PR
            const prUrl = await this.gitUtils.createPr({
                repo: this.validatedRepoName,
                head: branch,
                base: version,
                title: title,
                body: body
            });
            
            // Handle PR assignment and reviewers
            const prNumber = prUrl.trim().split('/').pop() || '';
            
            if (prNumber) {
                const assignee = await this.handlePRAssignment();
                const reviewer = await this.selectReviewer();

                await this.gitUtils.editPr({
                    number: prNumber,
                    repo: this.validatedRepoName,
                    assignee: assignee,
                    reviewer: reviewer
                });
            }
        } catch (error: any) {
            throw new Error(`Command failed: ${error.stderr || error.message}`);
        }
    }

    private async handlePRAssignment(): Promise<string | undefined> {
        const selection = await vscode.window.showQuickPick(
            [
                { 
                    label: this.strings.pr_self_assign_yes, 
                    description: this.strings.pr_self_assign_yes_desc 
                },
                { 
                    label: this.strings.pr_self_assign_no, 
                    description: this.strings.pr_self_assign_no_desc 
                }
            ],
            { placeHolder: this.strings.pr_self_assign_prompt }
        );

        if (selection?.label === this.strings.pr_self_assign_yes) {
            return '@self';
        }

        const users = await this.fetchGitHubUsers();
        const assignee = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: this.strings.pr_select_assignee }
        );

        return assignee?.label;
    }

    private async selectReviewer(): Promise<string | undefined> {
        const users = await this.fetchGitHubUsers();
        const reviewer = await vscode.window.showQuickPick(
            users.map(user => ({ label: `@${user}` })),
            { placeHolder: this.strings.pr_select_reviewer }
        );
        return reviewer?.label;
    }

    private async fetchGitHubUsers(): Promise<string[]> {
        try {
            const [owner] = this.validatedRepoName.split('/');
            const currentUser = await this.gitUtils.getCurrentUser();
            const isPersonalRepo = owner.trim() === currentUser.trim();

            if (isPersonalRepo) {
                const collaborators = await this.gitUtils.getRepoCollaborators(this.validatedRepoName);
                return [...new Set([currentUser.trim(), ...collaborators])];
            } else {
                try {
                    const orgMembers = await this.gitUtils.getOrgMembers(owner);
                    const collaborators = await this.gitUtils.getRepoCollaborators(this.validatedRepoName);
                    return [...new Set([...orgMembers, ...collaborators])];
                } catch (error) {
                    return await this.gitUtils.getRepoCollaborators(this.validatedRepoName);
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`${this.strings.pr_fetch_github_users_failed}: ${error.message}`);
            return [];
        }
    }

    private validateRepoFormat(repoName: string): boolean {
        return true;
    }
}