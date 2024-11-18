import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceService } from './services/workspaceService';
import { GitUtils } from './utils/git';
import { StateService } from './services/stateService';
import { WebviewService } from './services/webviewService';
import { RepoService } from './services/repoService';
import { PullRequestService } from './services/pullRequestService';
import { GitBranchService } from './services/gitBranchService';
import { UIHelper } from './utils/ui';

export function activate(context: vscode.ExtensionContext) {
    // Initialize core services
    const workspaceService = WorkspaceService.getInstance();
    const gitUtils = new GitUtils(workspaceService);
    const repoService = new RepoService(gitUtils);
    const stateService = new StateService(context, gitUtils);
    const webviewService = new WebviewService(context);
    const gitBranchService = new GitBranchService(gitUtils, stateService);
    const uiHelper = new UIHelper();

    const disposable = vscode.commands.registerCommand('backporter-x-5000.openWebview', async () => {
        const panel = vscode.window.createWebviewPanel(
            'backporterX5000',
            'Backporter X-5000',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'build')),
                    vscode.Uri.file(path.join(context.extensionPath, 'media')),
                ],
                retainContextWhenHidden: true,
            }
        );

        // Set webview content
        panel.webview.html = await webviewService.getWebviewContentWithCSP(panel.webview);

        // Handle webview messages
        panel.webview.onDidReceiveMessage(
            async message => {
                await stateService.handleMessage(message, panel);
            },
            undefined,
            context.subscriptions
        );
    });

    // Handle branch creation events
    stateService.onBranchCreationRequested(async (pendingBranch) => {
        const { repoName, versions, commitHash } = pendingBranch;

        for (const version of versions) {
            const branchName = await gitUtils.getBranchNameFromCommit(commitHash);
            const newBranch = `backport/${branchName}/${version}`;

            const success = await gitBranchService.createBranchAndCherryPick(
                version,
                commitHash,
                newBranch
            );

            if (success) {
                const pullRequestService = new PullRequestService(repoName, repoService, gitUtils);
                await pullRequestService.getPRUrlWithRetry(repoName, newBranch, version);
            }
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}