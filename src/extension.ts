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
import { LanguageService } from './services/languageService';

export function activate(context: vscode.ExtensionContext) {
    // Initialize core services
    const languageService = new LanguageService(context);
    const workspaceService = WorkspaceService.getInstance();
    const gitUtils = new GitUtils(workspaceService);
    const repoService = new RepoService(gitUtils, languageService);
    const stateService = new StateService(context, gitUtils, languageService);
    const gitBranchService = new GitBranchService(gitUtils, stateService, languageService);
    const uiHelper = new UIHelper();
    const webviewService = new WebviewService(context, languageService);

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
    
        // Set initial webview content with current language
        panel.webview.html = await webviewService.getWebviewContentWithCSP(panel.webview);
    
        // Send initial language to webview
        const initialLanguage = languageService.getCurrentLanguage();
        console.log('Sending initial language to webview:', initialLanguage);
    
        // Handle webview messages
        panel.webview.onDidReceiveMessage(
            async message => {
                try {
                    console.log('[Extension] Message received type:', message.type);
                    
                    if (message.type === 'languageChange') {
                        const newLanguage = message.payload.language;
                        await languageService.changeLanguage(newLanguage);
                        const updatedStrings = languageService.getStringsForLanguage(newLanguage);
                        
                        panel.webview.postMessage({
                            type: 'languageUpdate',
                            payload: {
                                language: newLanguage,
                                strings: updatedStrings
                            }
                        });
                        
                        // Update webview content to reflect new language
                        panel.webview.html = await webviewService.getWebviewContentWithCSP(panel.webview);
                    } else {
                        await stateService.handleMessage(message, panel);
                    }
                } catch (error) {
                    console.error('[Extension] Error handling message:', error);
                }
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
                const pullRequestService = new PullRequestService(repoName, repoService, gitUtils, languageService);
                await pullRequestService.getPRUrlWithRetry(repoName, newBranch, version);
            }
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}