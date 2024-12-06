import * as vscode from "vscode";
import {
  StateData,
  WebviewMessage,
  MessageType,
  PendingBranch,
} from "../types";
import { GitUtils } from "../utils/git";
import { LanguageService } from "./languageService";
import { PullRequestService } from "./pullRequestService";

export class StateService {
  private state: StateData;
  private readonly stateChangeEmitter = new vscode.EventEmitter<StateData>();
  private readonly branchCreationEmitter =
    new vscode.EventEmitter<PendingBranch>();
  private readonly conflictStateEmitter = new vscode.EventEmitter<{
    hasConflicts: boolean;
    files?: string[];
    branch?: string;
  }>();
  private readonly conflictResolutionEmitter = new vscode.EventEmitter<{
    resolved: boolean;
    branch?: string;
  }>();

  readonly onStateChanged = this.stateChangeEmitter.event;
  readonly onBranchCreationRequested = this.branchCreationEmitter.event;
  readonly onConflictStateChanged = this.conflictStateEmitter.event;
  readonly onConflictResolution = this.conflictResolutionEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitUtils: GitUtils,
    private readonly languageService: LanguageService,
    private readonly pullRequestServiceFactory: (repoName: string) => Promise<PullRequestService>
  ) {
    this.state = this.initializeState();
  }

  private initializeState(): StateData {
    return {
      savedVersions: this.context.globalState.get("savedVersions", {}),
      savedRepos: this.context.globalState.get("savedRepos", []),
      lastUpdated: Date.now(),
      pendingOperations: {},
    };
  }

  async handleConflictResolution(branch: string): Promise<void> {
    const pendingBranch = this.state.pendingOperations.cherryPick;
    if (!pendingBranch) {return;}
  
    try {
      // Push branch first
      await this.gitUtils.ensureBranchPushed(branch);
      
      const prService = await this.pullRequestServiceFactory(pendingBranch.repoName);
      await prService.createPullRequest(
        pendingBranch.prUrl,
        branch,
        pendingBranch.version
      );
  
      // Fire resolution event
      this.conflictResolutionEmitter.fire({
        resolved: true,
        branch
      });
    } catch (error) {
      console.error('Failed to handle conflict resolution:', error);
      throw error;
    }
  }
  
    async handlePullRequest(params: {
    repoName: string;
    prUrl: string;
    branch: string;
    version: string;
  }): Promise<void> {
    try {
      console.log("StateService.handlePullRequest called with:", params);
      
      // Log before push attempt
      console.log("Attempting to push branch:", params.branch);
      await this.gitUtils.push(params.branch);
      
      console.log("Branch pushed successfully, creating PR service for repo:", params.repoName);
      const prService = await this.pullRequestServiceFactory(params.repoName);
      
      await prService.createPullRequest(
        params.prUrl,
        params.branch,
        params.version
      );
    } catch (error) {
      console.error('Failed to create PR:', error);
      throw error;
    }
  }

  async handleLanguageChange(
    message: WebviewMessage,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    console.log("[StateService] Language change requested:", message.payload);
    const newLanguage = message.payload.language;
    await this.languageService.changeLanguage(newLanguage);

    // Get complete strings for the new language
    const strings = this.languageService.getStringsForLanguage(newLanguage);

    // Send both language and strings to webview
    panel.webview.postMessage({
      type: "languageUpdate",
      payload: {
        language: newLanguage,
        strings: strings,
        labels: {
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
        },
      },
    });
  }

  async handleMessage(
    message: WebviewMessage,
    panel?: vscode.WebviewPanel,
  ): Promise<void> {
    const strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );

    try {
      console.log("[StateService] Handling message type:", message.type);

      switch (message.type as MessageType) {
        case "error":
          vscode.window.showErrorMessage(
            strings.error_state_generic.replace("{0}", message.payload),
          );
          break;
        case "test":
          this.handleTest(message);
          break;
        case "loadSavedVersions":
          if (!message.payload?.repoName) {
            vscode.window.showErrorMessage(strings.error_repo_required);
            return;
          }
          await this.handleLoadSavedVersions(message, panel!);
          break;
        case "deleteVersion":
          if (!message.payload?.repoName || !message.payload?.version) {
            vscode.window.showErrorMessage(strings.error_version_empty);
            return;
          }
          await this.handleDeleteVersion(message, panel!);
          break;
        case "formSubmit":
          await this.handleFormSubmit(message);
          break;
        case "webviewReady":
          if (panel) {
            const currentLanguage = this.languageService.getCurrentLanguage();
            panel.webview.postMessage({
              type: "initialLanguage",
              payload: currentLanguage,
            });
          }
          break;
        case "languageChange":
          if (!panel) {
            throw new Error("Panel is required for language change");
          }
          console.log(
            "[StateService] Processing language change:",
            message.payload,
          );
          await this.handleLanguageChange(message, panel);
          break;
        default:
          console.error("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[StateService] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        strings.error_state_generic.replace("{0}", errorMessage),
      );
    }
  }

  private handleTest(message: WebviewMessage): void {
    console.log("Test message received:", message.payload);
  }

  private async handleLoadSavedVersions(
    message: WebviewMessage,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    // Add null check and default value for payload
    const repoName = message?.payload?.repoName;
    if (!repoName) {
      throw new Error("Repository name is required");
    }

    const versions = await this.getSavedVersions(repoName);
    panel.webview.postMessage({
      type: "savedVersions",
      versions,
    });
  }

  private async handleDeleteVersion(
    message: WebviewMessage,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      const { repoName, version } = message.payload;

      if (!repoName?.trim() || !version?.trim()) {
        throw new Error("Repository name and version cannot be empty");
      }

      // Delete version directly from state
      if (this.state.savedVersions[repoName]) {
        this.state.savedVersions[repoName] = this.state.savedVersions[
          repoName
        ].filter((v) => v !== version);
        await this.saveState();
      }

      // Update webview with new versions
      panel.webview.postMessage({
        type: "savedVersions",
        versions: this.state.savedVersions[repoName] || [],
      });
    } catch (error) {
      console.error("Error deleting version:", error);
      throw error;
    }
  }

  async saveRepo(repoName: string): Promise<void> {
    if (!repoName?.trim()) {
      throw new Error("Repository name cannot be empty");
    }

    if (!this.state.savedRepos.includes(repoName)) {
      this.state.savedRepos.push(repoName);
      await this.saveState();
    }
  }

  async deleteRepo(repoName: string): Promise<void> {
    this.state.savedRepos = this.state.savedRepos.filter((r) => r !== repoName);
    delete this.state.savedVersions[repoName];
    await this.saveState();
  }

  async getSavedRepos(): Promise<string[]> {
    return [...this.state.savedRepos];
  }

  async saveVersions(repoName: string, versions: string[]): Promise<void> {
    if (!repoName?.trim()) {
      throw new Error("Repository name cannot be empty");
    }
  
    // Get existing versions first
    const existingVersions = this.state.savedVersions[repoName] || [];
    
    // Merge existing and new versions, remove duplicates
    const uniqueVersions = Array.from(new Set([
      ...existingVersions,
      ...versions.filter(Boolean)
    ]));
  
    // Update state with merged versions
    this.state.savedVersions[repoName] = uniqueVersions;
    await this.saveState();
  }

  async getSavedVersions(repoName: string): Promise<string[]> {
    return [...(this.state.savedVersions[repoName] || [])];
  }

private async saveState(): Promise<void> {
  try {
    await Promise.all([
      this.context.globalState.update("savedVersions", this.state.savedVersions),
      this.context.globalState.update("savedRepos", this.state.savedRepos)
    ]);
    
    // Verify the save
    const savedVersions = this.context.globalState.get("savedVersions");
    const savedRepos = this.context.globalState.get("savedRepos");
    
    if (!savedVersions || !savedRepos) {
      throw new Error("Failed to save state");
    }

    this.state.lastUpdated = Date.now();
    this.stateChangeEmitter.fire(this.state);
  } catch (error) {
    console.error("Failed to save state:", error);
    throw error;
  }
}


  private async handleFormSubmit(message: WebviewMessage): Promise<void> {
    const strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );

    if (!(await this.gitUtils.validateGitRepo())) {
      throw new Error(strings.error_git_repo);
    }

    const { repoName, newRepoName, versions, cherryPickCommit, prUrl } =
      message.payload;
    const finalRepoName = newRepoName.trim() || repoName;

    // Validate required fields
    if (!finalRepoName) {
      throw new Error(strings.error_repo_required);
    }

    if (!(await this.gitUtils.validatePrUrl(prUrl))) {
      throw new Error(strings.error_invalid_pr_url);
    }

    // Save new repo if provided
    if (newRepoName.trim()) {
      await this.saveRepo(newRepoName.trim());
    }

    const inputVersions = versions
      .split(",")
      .map((v: string) => v.trim())
      .filter(Boolean);

    if (inputVersions.length === 0) {
      throw new Error(strings.error_version_required);
    }

    await this.saveVersions(finalRepoName, inputVersions);

    // Create a pending branch for each version
    for (const version of inputVersions) {
      const branchName =
        await this.gitUtils.getBranchNameFromCommit(cherryPickCommit);
      const newBranch = `backport/${branchName}/${version}`;

      const pendingBranch: PendingBranch = {
        repoName: finalRepoName,
        version,
        versions: inputVersions,
        cherryPickCommit,
        commitHash: cherryPickCommit,
        newBranch,
        prUrl,
      };

      this.branchCreationEmitter.fire(pendingBranch);
      await this.context.workspaceState.update(
        "pendingBranches",
        pendingBranch,
      );
    }
  }

  private updateOperationState(
    update: Partial<StateData["pendingOperations"]>,
  ): void {
    this.state.pendingOperations = {
      ...this.state.pendingOperations,
      ...update,
    };
    this.stateChangeEmitter.fire(this.state);
  }

    async updateCherryPickState(status: {
    inProgress: boolean;
    branch: string;
    commit: string;
    hasConflicts: boolean;
    repoName: string;
    prUrl: string;
    version: string;
    files?: string[];
    success?: boolean;
  }): Promise<void> {
    console.log("Updating cherry-pick state:", status);
  
    if (!this.state.pendingOperations.cherryPick) {
      // Initialize if doesn't exist
      this.state.pendingOperations.cherryPick = status;
    } else {
      // Update existing state
      this.state.pendingOperations.cherryPick = {
        ...this.state.pendingOperations.cherryPick,
        ...status
      };
    }
  
    if (!status.hasConflicts && status.success && status.branch) {
      await this.handlePullRequest({
        repoName: status.repoName,
        prUrl: status.prUrl,
        branch: status.branch,
        version: status.version
      });
    }
  
    // Emit state changes
    if ('hasConflicts' in status) {
      this.conflictStateEmitter.fire({
        hasConflicts: status.hasConflicts,
        files: status.files,
        branch: status.branch
      });
    }
  
    // Save state changes
    await this.saveState();
  }

  async reset(): Promise<void> {
    this.state = {
      savedVersions: {},
      savedRepos: [],
      lastUpdated: Date.now(),
      pendingOperations: {},
    };
    await this.saveState();
  }

  getState(): Readonly<StateData> {
    return { ...this.state };
  }
}
