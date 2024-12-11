import * as vscode from "vscode";
import * as path from "path";
import { GitUtils } from "../utils/git";
import { WorkspaceService } from "./workspaceService";
import { StateService } from "./stateService";
import { LanguageService } from "./languageService";
import { BranchCreationResult } from "../types";
import { UIInteractionService} from "./uiInteractionService";

export class GitBranchService {
  private workspaceService: WorkspaceService;
  private strings: any;

  constructor(
    private readonly gitUtils: GitUtils,
    private readonly stateService: StateService,
    private readonly languageService: LanguageService,
    private readonly uiInteractionService: UIInteractionService
  ) {
    this.workspaceService = WorkspaceService.getInstance();
    this.strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage()
    );
  }

  async createBranchAndCherryPick(
    version: string,
    cherryPickCommit: string,
    newBranch: string,
  ): Promise<BranchCreationResult> {
    const originalBranch = await this.gitUtils.getCurrentBranch();

    try {
      await this.prepareForOperation(cherryPickCommit);
      const finalBranchName = await this.handleBranchCreation(newBranch, version);
      
      if (!finalBranchName) {
        throw new Error(this.strings.error_branch_creation_failed);
      }

      return await this.executeCherryPick(cherryPickCommit, finalBranchName);

    } catch (error: any) {
      return await this.handleOperationError(error, newBranch, originalBranch);
    }
  }

  private async prepareForOperation(cherryPickCommit: string): Promise<void> {
    await this.stateService.updateBranchCreationState({ status: "pending" });
    await this.stateService.resetCherryPickState();
    await this.gitUtils.pullLatest();
    await this.gitUtils.validateAndFetchCommit(cherryPickCommit);
  }

  private async handleBranchCreation(branchName: string, version: string): Promise<string> {
    // If branch exists, clean it up first
    const branchExists = await this.gitUtils.branchExists(branchName);
    if (branchExists) {
      await this.gitUtils.performCleanup({
        branch: branchName,
        originalBranch: await this.gitUtils.getCurrentBranch(),
        force: true
      });
    }
  
    await this.gitUtils.checkout(version);
    await this.gitUtils.pullLatest(version);
    await this.gitUtils.createBranch(branchName);
    
    return branchName;
  }

  private async executeCherryPick(
    cherryPickCommit: string,
    branchName: string
  ): Promise<BranchCreationResult> {
    const isMergeCommit = await this.gitUtils.checkIfMergeCommit(cherryPickCommit);
    
    try {
      await this.stateService.startCherryPick(branchName, cherryPickCommit);
      await this.gitUtils.cherryPick(cherryPickCommit, isMergeCommit);
      
      const conflictedFiles = await this.gitUtils.getConflictedFiles();
      if (conflictedFiles.length > 0) {
        return this.handleConflictDetection(branchName, conflictedFiles);
      }

      await this.finalizeSuccessfulCherryPick(branchName, cherryPickCommit);
      return { success: true, hasConflicts: false };

    } catch (error) {
      const conflictedFiles = await this.gitUtils.getConflictedFiles();
      if (conflictedFiles.length > 0) {
        return this.handleConflictDetection(branchName, conflictedFiles);
      }
      throw error;
    }
  }


  private async handleConflictDetection(
    branchName: string,
    conflictedFiles: string[]
  ): Promise<BranchCreationResult> {
    const cherryPickState = this.stateService.getState().pendingOperations.cherryPick;
    await this.stateService.handleConflict(branchName, cherryPickState?.commit || '', conflictedFiles);
    
    try {
      // Watch for resolution via pop up (this now handles file opening too)
      const conflictResolved = await this.uiInteractionService.watchConflictedFiles(conflictedFiles);
  
      if (conflictResolved) {
        await this.completeConflictResolution(branchName);
        return { success: true, hasConflicts: false };
      }
      
      // Handle abort case
      await this.gitUtils.abortCherryPick();
      await this.stateService.resetCherryPickState({ keepBranch: true, branch: branchName });
      return {
        success: false,
        hasConflicts: true,
        error: this.strings.conflict_aborted
      };
    } catch (error) {
      await this.gitUtils.abortCherryPick();
      await this.stateService.resetCherryPickState({ keepBranch: true, branch: branchName });
      return {
        success: false, 
        hasConflicts: true,
        error: this.strings.error_conflict_resolution
      };
    }
  }

  private async completeConflictResolution(branchName: string): Promise<void> {
    await this.gitUtils.addAll();
    await this.gitUtils.cherryPickContinue();
    await this.gitUtils.push(branchName);
    await this.stateService.resolveConflict(branchName, true);
  }


  private async finalizeSuccessfulCherryPick(
    branchName: string,
    commit: string
  ): Promise<void> {
    await this.gitUtils.push(branchName);
    await this.stateService.finishCherryPick(branchName, true);
  }

  private async handleOperationError(
    error: any, 
    newBranch: string, 
    originalBranch: string
  ): Promise<BranchCreationResult> {
    const errorMessage = error.message?.toLowerCase() || '';
    const isKnownError = [
      "no cherry-pick or revert in progress",
      "could not apply",
      "needs merge",
      "already exists",
      "is a merge but no -m option was given",
    ].some(msg => errorMessage.includes(msg.toLowerCase()));

    await this.gitUtils.handleGitError(error, newBranch, originalBranch, !isKnownError);
    
    if (isKnownError) {
      await this.stateService.updateBranchCreationState({ 
        status: "failed",
        error: error.message 
      });
    }
    
    return {
      success: false,
      hasConflicts: false,
      error: isKnownError ? 
        this.strings.error_cherry_pick_failed : 
        this.strings.error_unknown
    };
  }
}
