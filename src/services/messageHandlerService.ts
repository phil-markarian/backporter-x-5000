import * as vscode from "vscode";
import { GitUtils } from "../utils/git";
import { StateService } from "./stateService";
import { LanguageService } from "./languageService";
import { PullRequestService } from "./pullRequestService";
import { MessageType, WebviewMessage } from "../types";
import { WebviewService } from "./webviewService";
import { ProgressManagerService } from "./progressManagerService";
import { GitBranchService } from "./gitBranchService";

export class MessageHandlerService {
  constructor(
    private readonly stateService: StateService,
    private readonly gitUtils: GitUtils,
    private readonly languageService: LanguageService,
    private readonly webviewService: WebviewService,
    private readonly progressManagerService: ProgressManagerService,
    private readonly gitBranchService: GitBranchService,
    private readonly pullRequestServiceFactory: (repoName: string) => Promise<PullRequestService>
  ) {}

  private async validateFormSubmission(
    repoName: string, 
    versions: string,
    prUrl: string
  ): Promise<void> {
    const strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage()
    );

    if (!(await this.gitUtils.validateGitRepo())) {
      throw new Error(strings.error_git_repo);
    }

    if (!repoName) {
      throw new Error(strings.error_repo_required);
    }

    if (versions.length === 0 || !versions.trim()) {
        throw new Error(strings.error_version_required);
    }

    const isValid = await this.validatePrUrl({ type: "validatePrUrl", payload: prUrl }, null as any);
    if (!isValid) {
        throw new Error(strings.error_invalid_pr_url);
    }
  }

  private parseVersions(versions: string): string[] {
    return versions
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
  }

  private async validatePrUrl(message: WebviewMessage, panel: vscode.WebviewPanel): Promise<boolean> {
    try {
      const isValid = await this.gitUtils.validatePrUrl(message.payload);
      if (panel) {
        await panel.webview.postMessage({
          type: "prUrlValidation",
          payload: { isValid }
        });
      }
      return isValid;
    } catch (error) {
      if (panel) {
        await panel.webview.postMessage({
          type: "prUrlValidation",
          payload: { isValid: false }
        });
      }
      return false;
    }
  }

  async handleMessage(message: WebviewMessage, panel?: vscode.WebviewPanel): Promise<void> {
  if (!panel) {
    throw new Error(this.languageService.getString("error_panel_required"));
  }

  try {
    console.log("[MessageHandler] Handling message type:", message.type);

    switch (message.type) {
      case "languageChange":
        await this.handleLanguageChange(message, panel);
        break;

      case "formSubmit":
        await this.handleFormSubmit(message, panel);
        break;

      case "validatePrUrl":
        await this.validatePrUrl(message, panel);
        break;

      case "loadSavedVersions":
        await this.handleLoadSavedVersions(message, panel);
        break;

      case "deleteVersion":
        await this.handleDeleteVersion(message, panel);
        break;

      case "webviewReady":
        await panel.webview.postMessage({
          type: "initialLanguage",
          payload: this.languageService.getCurrentLanguage()
        });
        break;

      default:
        console.error("[MessageHandler] Unknown message type:", message.type);
        throw new Error(this.languageService.getString("error_unknown_message_type"));
    }
  } catch (error: any) {
    console.error("[MessageHandler] Error:", error);
    this.progressManagerService.showError(error);
    throw error;
  }
}

  private async handleLanguageChange(message: WebviewMessage, panel: vscode.WebviewPanel): Promise<void> {
    console.log("[MessageHandler] Language change requested:", message.payload.language);
    const newLanguage = message.payload.language;

    try {
      // 1. Change language and get strings
      await this.languageService.changeLanguage(newLanguage);
      const updatedStrings = this.languageService.getStringsForLanguage(newLanguage);
      console.log("[MessageHandler] Got updated strings:", Object.keys(updatedStrings).length);

      // 2. Update webview HTML
      const updatedHtml = await this.webviewService.getWebviewContentWithCSP(
        panel.webview,
        newLanguage,
        updatedStrings
      );
      panel.webview.html = updatedHtml;

      // 3. Wait for HTML update
      await new Promise(resolve => setTimeout(resolve, 200));

      // 4. Send strings update
      await panel.webview.postMessage({
        type: "languageUpdate",
        payload: {
          language: newLanguage,
          strings: updatedStrings
        }
      });

      console.log("[MessageHandler] Language switch completed");
    } catch (error: any) {
      console.error("[MessageHandler] Language switch failed:", error);
        throw error;
      }
    }

    private async handleLoadSavedVersions(
        message: WebviewMessage,
        panel: vscode.WebviewPanel,
      ): Promise<void> {
        try {
          const repoName = message?.payload?.repoName;
          if (!repoName) {
            throw new Error(this.languageService.getString("error_repo_required"));
          }
      
          // Keep existing core functionality
          const versions = await this.stateService.getSavedVersions(repoName);
          await panel.webview.postMessage({
            type: "savedVersions",
            versions
          });
        } catch (error: any) {
          console.error("[LoadSavedVersions] Error:", error);
          this.progressManagerService.showError(error);
          throw error;
        }
      }

  private async handleDeleteVersion(
    message: WebviewMessage,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      const { repoName, version } = message.payload;
      if (!repoName || !version) {
        throw new Error(this.languageService.getString("error_version_empty"));
      }
  
      // Keep existing core functionality
      await this.stateService.deleteVersion(repoName, version);
      const updatedVersions = await this.stateService.getSavedVersions(repoName);
      await panel.webview.postMessage({
        type: "savedVersions",
        versions: updatedVersions
      });
    } catch (error: any) {
      console.error("[DeleteVersion] Error:", error);
      this.progressManagerService.showError(error);
      throw error;
    }
  }

  private async handleFormSubmit(message: WebviewMessage, panel: vscode.WebviewPanel): Promise<void> {
    // Check if message.data exists since the form data is sent in the data property
  if (!message.payload) {
    throw new Error(this.languageService.getString("error_invalid_form_data"));
  }

  const formData = message.payload as BackportFormData;
    const finalRepoName = formData.newRepoName.trim() || formData.repoName;
  
    try {
      // Validate and save initial data
      await this.validateFormSubmission(finalRepoName, formData.versions, formData.prUrl);
      
      if (formData.newRepoName.trim()) {
        await this.stateService.saveRepo(formData.newRepoName.trim());
      }
  
      const inputVersions = this.parseVersions(formData.versions);
      await this.stateService.saveVersions(finalRepoName, inputVersions);

      // Create PRService instance ONCE outside the loop
      const prService = await this.pullRequestServiceFactory(finalRepoName);

      // Track progress for backport process
      await this.progressManagerService.trackProgress({
        title: "backport_starting",
        operation: async (progress) => {
          let completedVersions = 0;
          const totalVersions = inputVersions.length;
  
          for (const version of inputVersions) {
            try {
              this.progressManagerService.updateProgress(
                (completedVersions / totalVersions) * 100,
                this.languageService.getString("progress_version_processing")
                  .replace("{0}", version)
                  .replace("{1}", String(completedVersions + 1))
                  .replace("{2}", String(totalVersions))
              );
              await this.gitUtils.checkout("main");
              const branchName = await this.gitUtils.getBranchNameFromCommit(formData.cherryPickCommit);
              const newBranch = `backport/${branchName}/${version}`;
  
              // Cherry-pick and handle conflicts
              const result = await this.gitBranchService.createBranchAndCherryPick(
                version,
                formData.cherryPickCommit,
                newBranch
              );
  
              if (result.hasConflicts) {
                if (!result.success) {
                  console.error(`Skipping version ${version}`);
                  // Need to handle error here somehow 
                  continue;
                }
              }
  
              if (result.success || await this.gitUtils.branchExists(newBranch)) {
                console.log("Attempting PR creation for branch:", newBranch);
                await prService.createPullRequest(formData.prUrl, newBranch, version);
                console.log("PR created successfully for version:", version);
                completedVersions++;
              }

            } catch (versionError) {
              console.error(`Error processing version ${version}:`, versionError);
            }
          }

          // Force update summary for all PRs after loop completes
          await prService.updateAllPRsWithSummary();
  
          if (completedVersions > 0) {
            this.progressManagerService.showSuccess(
              this.languageService.getString("backport_success")
            );
          } else {
            throw new Error(this.languageService.getString("error_no_versions_processed"));
          }
        }
      });
    } catch (error: any) {
      this.progressManagerService.showError(error);
    }
  }

  private buildLabels(strings: any) {
    return {
        repoNameLabel: strings.repo_name_label,
        selectRepository: strings.select_repository,
        newRepoLabel: strings.new_repo_label,
        savedVersionsLabel: strings.saved_versions_label,
        versionsLabel: strings.versions_label,
        cherryPickLabel: strings.cherry_pick_label,
        submitButton: strings.submit_button,
        loadingText: strings.loading_text,
        errorTitle: strings.error_title,
        successTitle: strings.success_title,
        languageSelector: strings.language_selector,
        versionRemoveTitle: strings.version_remove_title,
    };
  }
}