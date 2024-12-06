import * as vscode from "vscode";
import * as path from "path";
import { GitUtils } from "./utils/git";
import { WorkspaceService } from "./services/workspaceService";
import { StateService } from "./services/stateService";
import { GitBranchService } from "./services/gitBranchService";
import { LanguageService } from "./services/languageService";
import { WebviewService } from "./services/webviewService";
import { PullRequestService } from "./services/pullRequestService";

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const languageService = new LanguageService(context);
  const workspaceService = WorkspaceService.getInstance();
  const gitUtils = new GitUtils(workspaceService, languageService);

  const pullRequestServiceFactory = async (repoName: string) => {
    const prService = new PullRequestService(repoName, gitUtils, languageService);
    await prService.init();
    return prService;
  };

  const stateService = new StateService(
    context, 
    gitUtils, 
    languageService,
    pullRequestServiceFactory
  );

  const gitBranchService = new GitBranchService(
    gitUtils,
    stateService,
    languageService
  );

  const webviewService = new WebviewService(context, languageService);

  // Track panel and progress globally
  let activePanel: vscode.WebviewPanel | undefined;
  let activeProgress: vscode.Progress<{ message?: string; increment?: number }> | undefined;

  function isPanelActive(panel: vscode.WebviewPanel): boolean {
    try {
      return panel.active;
    } catch (e) {
      return false;
    }
  }

  stateService.onConflictStateChanged(async ({ hasConflicts, files, branch }) => {
    if (!activePanel || !isPanelActive(activePanel)) {
      return;
    }

    if (hasConflicts) {
      activeProgress?.report({
        message: languageService.getString("resolving_conflicts")
      });
      
      activePanel.webview.postMessage({
        type: "conflictState",
        payload: {
          hasConflicts: true,
          files: files || []
        }
      });
    } else if (branch) {
      try {
        await stateService.handleConflictResolution(branch);

        activePanel.webview.postMessage({
          type: "loading",
          payload: false
        });
        activePanel.webview.postMessage({
          type: "success",
          payload: languageService.getString("backport_success")
        });

        activeProgress?.report({
          increment: 100,
          message: ""
        });
      } catch (error: any) {
        activePanel.webview.postMessage({
          type: "loading",
          payload: false
        });
        activePanel.webview.postMessage({
          type: "error",
          payload: error.message
        });
        throw error;
      }
    }
  });



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
              path.join(
                context.extensionPath,
                "build",
                "webview",
                "ui",
                "webview",
              ),
            ),
            vscode.Uri.file(path.join(context.extensionPath, "media")),
          ],
          retainContextWhenHidden: true,
        },
      );

      // Send initial language to webview
      const initialLanguage = languageService.getCurrentLanguage();
      const initialStrings =
        languageService.getStringsForLanguage(initialLanguage);
      console.log("Sending initial language to webview:", initialLanguage);

      // Set initial webview content
      panel.webview.html = await webviewService.getWebviewContentWithCSP(
        panel.webview,
        initialLanguage,
        initialStrings,
      );

      // Send initial language state
      panel.webview.postMessage({
        type: "languageUpdate",
        payload: {
          language: initialLanguage,
          strings: languageService.getStringsForLanguage(initialLanguage),
        },
      });

      // Handle webview messages
      panel.webview.onDidReceiveMessage(
        async (message) => {
          try {
            console.log("[Extension] Message received type:", message.type);

            switch (message.type) {
              case "languageChange":
                console.log(
                  "[Extension] Language change requested:",
                  message.payload.language,
                );
                const newLanguage = message.payload.language;

                try {
                  // 1. Change language first
                  await languageService.changeLanguage(newLanguage);
                  const updatedStrings =
                    languageService.getStringsForLanguage(newLanguage);
                  console.log(
                    "[Extension] Got updated strings:",
                    Object.keys(updatedStrings).length,
                  );

                  // 2. Update webview HTML with new language
                  const updatedHtml =
                    await webviewService.getWebviewContentWithCSP(
                      panel.webview,
                      newLanguage,
                      updatedStrings,
                    );
                  panel.webview.html = updatedHtml;

                  // 3. Wait for HTML update
                  await new Promise((resolve) => setTimeout(resolve, 200));

                  // 4. Send strings update
                  await panel.webview.postMessage({
                    type: "languageUpdate",
                    payload: {
                      language: newLanguage,
                      strings: updatedStrings,
                    },
                  });

                  console.log("[Extension] Language switch completed");
                } catch (error: any) {
                  console.error("[Extension] Language switch failed:", error);
                  vscode.window.showErrorMessage(
                    `Failed to switch language: ${error.message}`,
                  );
                }
                break;

                            case "formSubmit": {
                if (!isPanelActive(panel)) {
                  return;
                }
              
                panel.webview.postMessage({ 
                  type: "loading",
                  payload: true 
                });
              
                await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Notification,
                  title: languageService.getString("backport_starting"),
                  cancellable: false
                }, async (progress) => {
                  activeProgress = progress;
                  try {
                    const formData = message.data;
                    const versions = formData.versions.split(",").map((v: string) => v.trim());
                    const repoName = formData.repoName || formData.newRepoName;
              
                    // Save versions and repo
                    await stateService.saveVersions(repoName, versions);
                    if (formData.newRepoName) {
                      await stateService.saveRepo(formData.newRepoName);
                    }
              
                    let completedVersions = 0;
                    const totalVersions = versions.length;
              
                    for (const version of versions) {
                      try {
                        const branchName = await gitUtils.getBranchNameFromCommit(
                          formData.cherryPickCommit
                        );
                        const newBranch = `backport/${branchName}/${version}`;
              
                        // Create promise to track conflict resolution
                        const conflictResolutionPromise = new Promise((resolve) => {
                          const disposable = stateService.onConflictResolution(({resolved, branch}) => {
                            if (branch === newBranch) {
                              disposable.dispose();
                              resolve(resolved);
                            }
                          });
                        });
              
                        await stateService.updateCherryPickState({
                          inProgress: true,
                          branch: newBranch,
                          commit: formData.cherryPickCommit,
                          hasConflicts: false,
                          repoName: repoName,
                          prUrl: formData.prUrl,
                          version: version
                        });
              
                        const result = await gitBranchService.createBranchAndCherryPick(
                          version,
                          formData.cherryPickCommit,
                          newBranch
                        );
              
                        // Wait for conflict resolution if needed
                        if (result.hasConflicts) {
                          const resolved = await conflictResolutionPromise;
                          if (!resolved) {
                            await gitUtils.abortCherryPick().catch(() => {});
                            await gitUtils.resetHard();
                            await gitUtils.checkout('main');
                            await gitUtils.deleteBranchSafely(newBranch, true);
                        
                            // Enable button and reset state
                            if (isPanelActive(panel)) {
                              panel.webview.postMessage({
                                type: "loading",
                                payload: { 
                                  isLoading: false,
                                  wasCancelled: true 
                                }
                              });
                            }
                            throw new Error('Conflict resolution aborted');
                          }
                        }
              
                        if (result.success || (result.hasConflicts && await gitUtils.branchExists(newBranch))) {
                          await stateService.handlePullRequest({
                            repoName,
                            prUrl: formData.prUrl,
                            branch: newBranch,
                            version
                          });
              
                          completedVersions++;
                          progress.report({
                            increment: (completedVersions / totalVersions) * 100,
                            message: `Completed ${completedVersions}/${totalVersions} versions`
                          });
                        }
                      } catch (error: any) {
                        console.error(`Error processing version ${version}:`, error);
                        if (error.message === 'Webview disposed') {
                          return;
                        }
                        break;
                      }
                    }
              
                    if (completedVersions > 0 && isPanelActive(panel)) {
                      panel.webview.postMessage({
                        type: "loading",
                        payload: false
                      });
                      panel.webview.postMessage({
                        type: "success",
                        payload: languageService.getString("backport_success")
                      });
                    }
                  } catch (error: any) {
                    if (isPanelActive(panel)) {
                      panel.webview.postMessage({
                        type: "loading",
                        payload: false
                      });
                      panel.webview.postMessage({
                        type: "error",
                        payload: error.message
                      });
                    }
                    console.error("PR creation failed:", error);
                  } finally {
                    activeProgress = undefined;
                  }
                });
                break;
              }

              case "validatePrUrl":
                try {
                  const isValid = await gitUtils.validatePrUrl(message.payload);
                  panel.webview.postMessage({
                    type: "prUrlValidation",
                    payload: { isValid },
                  });
                } catch (error) {
                  panel.webview.postMessage({
                    type: "prUrlValidation",
                    payload: { isValid: false },
                  });
                }
                break;

              default:
                await stateService.handleMessage(message, panel);
                break;
            }
          } catch (error: any) {
            console.error("[Extension] Error handling message:", error);
            vscode.window.showErrorMessage(error.message);
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
