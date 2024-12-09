import * as vscode from "vscode";
import {
  StateData,
  CherryPickState,
} from "../types";


export class StateService {
  private state: StateData;
  private readonly stateChangeEmitter = new vscode.EventEmitter<StateData>();
  private readonly conflictStateEmitter = new vscode.EventEmitter<{
    hasConflicts: boolean;
    files?: string[];
    branch?: string;
  }>();
  public conflictResolutionEmitter = new vscode.EventEmitter<{
    resolved: boolean;
    branch?: string;
  }>();

  readonly onStateChanged = this.stateChangeEmitter.event;
  readonly onConflictStateChanged = this.conflictStateEmitter.event;
  readonly onConflictResolution = this.conflictResolutionEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext
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


  async deleteVersion(repoName: string, version: string): Promise<void> {
    if (this.state.savedVersions[repoName]) {
      this.state.savedVersions[repoName] = this.state.savedVersions[repoName]
        .filter(v => v !== version);
      await this.saveState();
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

  async updateCherryPickState(status: CherryPickState): Promise<void> {
    this.updateOperationState({
      cherryPick: status
    });
    
    if ('hasConflicts' in status) {
      this.conflictStateEmitter.fire({
        hasConflicts: status.hasConflicts,
        files: status.files,
        branch: status.branch
      });
    }
  }

  async startCherryPick(branch: string, commit: string): Promise<void> {
    await this.updateCherryPickState({
      inProgress: true,
      branch,
      commit,
      hasConflicts: false,
      success: false
    });
  }

  async finishCherryPick(branch: string, success: boolean = true): Promise<void> {
    await this.updateCherryPickState({
      inProgress: false,
      branch,
      commit: '',
      hasConflicts: false,
      success
    });
  }

  async handleCherryPickError(branch: string, error?: string): Promise<void> {
    await this.updateCherryPickState({
      inProgress: false,
      branch,
      hasConflicts: false,
      success: false
    });
  }

  async resetCherryPickState(options?: { 
    keepBranch?: boolean,
    branch?: string 
  }): Promise<void> {
    await this.updateCherryPickState({
      inProgress: false,
      branch: options?.keepBranch ? (options.branch || '') : '',
      commit: '',
      hasConflicts: false,
      success: false,
      files: []
    });
    
    this.conflictStateEmitter.fire({
      hasConflicts: false,
      files: [],
      branch: options?.keepBranch ? (options.branch || '') : ''
    });
  }

  async handleConflict(branch: string, commit: string, files: string[]): Promise<void> {
    await this.updateCherryPickState({
      inProgress: true,
      branch,
      commit,
      hasConflicts: true,
      files,
      success: false
    });
    
    this.conflictStateEmitter.fire({
      hasConflicts: true,
      files,
      branch
    });
  }

  async resolveConflict(branch: string, resolved: boolean): Promise<void> {
    await this.updateCherryPickState({
      inProgress: false,
      branch,
      commit: '',
      hasConflicts: false,
      success: resolved
    });

    this.conflictResolutionEmitter.fire({
      resolved,
      branch
    });
  }

  async updateBranchCreationState(status: {
    status: "pending" | "success" | "failed";
    error?: string;
  }): Promise<void> {
    this.updateOperationState({
      branchCreation: status
    });
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
