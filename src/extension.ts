import * as vscode from "vscode";
import * as path from "path";
import { GitUtils } from "./utils/git";
import { WorkspaceService } from "./services/workspaceService";
import { StateService } from "./services/stateService";
import { GitBranchService } from "./services/gitBranchService";
import { LanguageService } from "./services/languageService";
import { WebviewService } from "./services/webviewService";
import { PullRequestService } from "./services/pullRequestService";
import { ProgressManagerService } from "./services/progressManagerService";
import { MessageHandlerService } from "./services/messageHandlerService";
import { UIService } from "./services/uiService";

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const languageService = new LanguageService(context);
  const workspaceService = WorkspaceService.getInstance();
  const gitUtils = new GitUtils(workspaceService, languageService);
  

  const stateService = new StateService(
    context
  );

  const progressManagerService = new ProgressManagerService(languageService, stateService);

  const uiService = new UIService(gitUtils, languageService);

  const gitBranchService = new GitBranchService(
    gitUtils,
    stateService,
    languageService,
    uiService
  );

 
  const pullRequestServiceFactory = async (repoName: string) => {
    const prService = new PullRequestService(repoName, gitUtils, languageService);
    await prService.init();
    return prService;
  };

  const webviewService = new WebviewService(context, languageService);
  
  const messageHandlerService = new MessageHandlerService(
    stateService,
    gitUtils,
    languageService,
    webviewService,
    progressManagerService,
    gitBranchService,
    pullRequestServiceFactory,
  );

  let activePanel: vscode.WebviewPanel | undefined;

    const disposable = vscode.commands.registerCommand(
    "backporter-x-5000.openWebview",
    async () => {
      const panel = vscode.window.createWebviewPanel(
        "backporterX5000",
        "Backporter X-5000",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.file(
              path.join(context.extensionPath, "build", "webview", "ui", "webview")
            ),
            vscode.Uri.file(path.join(context.extensionPath, "media")),
          ],
          retainContextWhenHidden: true,
        }
      );
  
      // Set active panel and initialize progress manager
      activePanel = panel;
      progressManagerService.setPanel(panel);
  
      // Set initial webview content
      panel.webview.html = await webviewService.getWebviewContentWithCSP(
        panel.webview,
        languageService.getCurrentLanguage(),
        languageService.getStringsForLanguage(languageService.getCurrentLanguage())
      );
  
      // Handle messages from webview
      panel.webview.onDidReceiveMessage(
        async (message) => {
          try {
            console.log("[Extension] Message received type:", message.type);
            await messageHandlerService.handleMessage(message, panel);
          } catch (error:any) {
            console.error("[Extension] Error handling message:", error);
            vscode.window.showErrorMessage(error.message);
          }
        },
        undefined,
        context.subscriptions
      );
  
      // Cleanup on panel close
      panel.onDidDispose(() => {
        activePanel = undefined;
        progressManagerService.setPanel(undefined);
      }, null, context.subscriptions);
    }
  );
  context.subscriptions.push(disposable);
}

export function deactivate() {}
