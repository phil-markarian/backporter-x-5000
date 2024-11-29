import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from './utils/git';
import { WorkspaceService } from './services/workspaceService';
import { StateService } from './services/stateService';
import { GitBranchService } from './services/gitBranchService';
import { LanguageService } from './services/languageService';
import { WebviewService } from './services/webviewService';
import { PullRequestService } from './services/pullRequestService';

export function activate(context: vscode.ExtensionContext) {
    // Initialize core services
    const languageService = new LanguageService(context);
    const workspaceService = WorkspaceService.getInstance();
    const gitUtils = new GitUtils(workspaceService, languageService);
    const stateService = new StateService(context, gitUtils, languageService);
    const gitBranchService = new GitBranchService(gitUtils, stateService, languageService);
    const webviewService = new WebviewService(context, languageService);

    // Handle branch creation events
    stateService.onBranchCreationRequested(async (pendingBranch) => {
        try {
            const success = await gitBranchService.createBranchAndCherryPick(
                pendingBranch.version,
                pendingBranch.cherryPickCommit,
                pendingBranch.newBranch
            );

            if (success) {
                const pullRequestService = new PullRequestService(
                    pendingBranch.repoName,
                    gitUtils,
                    languageService
                );

                await pullRequestService.createPullRequest(
                    pendingBranch.prUrl,
                    pendingBranch.newBranch,
                    pendingBranch.version
                );
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
        }
    });

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

        // Send initial language to webview
        const initialLanguage = languageService.getCurrentLanguage();
        const initialStrings = languageService.getStringsForLanguage(initialLanguage);
        console.log('Sending initial language to webview:', initialLanguage);

        // Set initial webview content
        panel.webview.html = await webviewService.getWebviewContentWithCSP(panel.webview, initialLanguage, initialStrings);

        
        
        // Send initial language state
        panel.webview.postMessage({
            type: 'languageUpdate',
            payload: {
                language: initialLanguage,
                strings: languageService.getStringsForLanguage(initialLanguage)
            }
        });

        // Handle webview messages
        panel.webview.onDidReceiveMessage(
            async message => {
                try {
                    console.log('[Extension] Message received type:', message.type);
                    
                    if (message.type === 'languageChange') {
                        console.log('[Extension] Language change requested:', message.payload.language);
                        const newLanguage = message.payload.language;
                        
                        try {
                            // 1. Change language first
                            await languageService.changeLanguage(newLanguage);
                            const updatedStrings = languageService.getStringsForLanguage(newLanguage);
                            console.log('[Extension] Got updated strings:', Object.keys(updatedStrings).length);
                    
                            // 2. Update webview HTML with new language
                            const updatedHtml = await webviewService.getWebviewContentWithCSP(
                                panel.webview,
                                newLanguage,
                                updatedStrings
                            );
                            panel.webview.html = updatedHtml;
                            
                            // 3. Wait for HTML update
                            await new Promise(resolve => setTimeout(resolve, 200));
                    
                            // 4. Send strings update
                            await panel.webview.postMessage({
                                type: 'languageUpdate',
                                payload: { 
                                    language: newLanguage, 
                                    strings: updatedStrings 
                                }
                            });
                    
                            console.log('[Extension] Language switch completed');
                        } catch (error: any) {
                            console.error('[Extension] Language switch failed:', error);
                            vscode.window.showErrorMessage(`Failed to switch language: ${error.message}`);
                        }
                    } else if (message.type === 'submitForm') {
                        const formData = message.data;
                        for (const version of formData.versions.split(',')) {
                            const branchName = await gitUtils.getBranchNameFromCommit(formData.cherryPickCommit);
                            const newBranch = `backport/${branchName}/${version}`;

                            const success = await gitBranchService.createBranchAndCherryPick(
                                version,
                                formData.cherryPickCommit,
                                newBranch
                            );

                            if (success) {
                                const pullRequestService = new PullRequestService(
                                    formData.repoName || formData.newRepoName,
                                    gitUtils,
                                    languageService
                                );
                                await pullRequestService.createPullRequest(
                                    formData.prUrl,
                                    newBranch,
                                    version
                                );
                            }
                        }
                    } else {
                        await stateService.handleMessage(message, panel);
                    }
                } catch (error: any) {
                    console.error('[Extension] Error handling message:', error);
                    vscode.window.showErrorMessage(error.message);
                }
            },
            undefined,
            context.subscriptions
        );
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}