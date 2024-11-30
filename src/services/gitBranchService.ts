import * as vscode from "vscode";
import * as path from "path";
import { GitUtils } from "../utils/git";
import { WorkspaceService } from "./workspaceService";
import { StateService } from "./stateService";
import { LanguageService } from "./languageService";

export class GitBranchService {
  private workspaceService: WorkspaceService;
  private strings: any;

  constructor(
    private readonly gitUtils: GitUtils,
    private readonly stateService: StateService,
    private readonly languageService: LanguageService,
  ) {
    this.workspaceService = WorkspaceService.getInstance();
    this.strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );
  }

  async createBranchAndCherryPick(
    version: string,
    cherryPickCommit: string,
    newBranch: string,
  ): Promise<boolean> {
    const originalBranch = await this.gitUtils.getCurrentBranch();

    try {
      // Validate commit exists
      const commitExists =
        await this.gitUtils.validateCommitExists(cherryPickCommit);
      if (!commitExists) {
        throw new Error(
          this.strings.error_not_found.replace("{0}", cherryPickCommit),
        );
      }

      // Fetch latest changes
      await this.gitUtils.fetchAll();

      // Check if branch exists and handle
      const branchExists = await this.gitUtils.branchExists(newBranch);
      if (branchExists) {
        const newBranchName = await this.handleExistingBranch(newBranch);
        if (!newBranchName) {
          return false;
        }
        newBranch = newBranchName;
      }

      // Checkout version branch and create new branch
      await this.gitUtils.checkout(version);
      await this.gitUtils.createBranch(newBranch);

      // Check if commit is a merge commit
      const isMergeCommit =
        await this.gitUtils.checkIfMergeCommit(cherryPickCommit);

      // Attempt cherry-pick with appropriate flags
      try {
        await this.gitUtils.cherryPick(cherryPickCommit, isMergeCommit);

        vscode.window.showInformationMessage(this.strings.success_title);

        return true;
      } catch (error: any) {
        const hasConflicts =
          error.message.includes("after resolving the conflicts") ||
          error.message.includes("could not apply") ||
          error.stderr?.includes("after resolving the conflicts") ||
          error.stderr?.includes("could not apply");

        if (hasConflicts) {
          const resolved = await this.handleCherryPickConflict(newBranch);
          if (!resolved) {
            await this.gitUtils.performCleanup({
              branch: newBranch,
              originalBranch,
              force: true,
            });
            return false;
          }
          return true;
        }
        throw error;
      }
    } catch (error: any) {
      const expectedErrors = [
        "no cherry-pick or revert in progress",
        "could not apply",
        "needs merge",
        "already exists",
        "is a merge but no -m option was given",
      ];

      if (!expectedErrors.some((msg) => error.message.includes(msg))) {
        await this.handleBranchCreationError(error, newBranch, originalBranch);
      } else {
        await this.gitUtils.performCleanup({
          branch: newBranch,
          originalBranch,
          force: true,
        });
      }
      return false;
    }
  }

  private async handleBranchCreationError(
    error: any,
    newBranch: string,
    originalBranch: string,
  ): Promise<void> {
    console.error(this.strings.error_branch_creation_failed, error);

    // Categorize error type
    let errorMessage = this.strings.error_unknown;
    if (error.message.includes("already exists")) {
      errorMessage = this.strings.error_branch_exists.replace("{0}", newBranch);
    } else if (error.message.includes("Permission denied")) {
      errorMessage = this.strings.error_permission_denied;
    } else if (error.message.includes("could not apply")) {
      errorMessage = this.strings.error_cherry_pick_failed;
    } else if (error.message.includes("not found")) {
      errorMessage = this.strings.error_not_found;
    } else if (error.message.includes("network")) {
      errorMessage = this.strings.error_network;
    }

    // Always try to cleanup
    await this.gitUtils.performCleanup({
      branch: newBranch,
      originalBranch,
      force: true,
    });
    vscode.window.showErrorMessage(
      this.strings.error_branch_creation_failed.replace("{0}", errorMessage),
    );
  }

  // TODO: figure out if I should remove this or not
  private async handleExistingBranch(
    branchName: string,
  ): Promise<string | null> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: this.strings.branch_auto_rename,
          description: this.strings.branch_auto_rename_desc,
        },
        {
          label: this.strings.branch_delete_recreate,
          description: this.strings.branch_delete_recreate_desc,
        },
        {
          label: this.strings.branch_cancel,
          description: this.strings.branch_cancel_desc,
        },
      ],
      {
        placeHolder: this.strings.branch_exists_message.replace(
          "{0}",
          branchName,
        ),
      },
    );

    switch (choice?.label) {
      case this.strings.branch_auto_rename:
        return `${branchName}-${Date.now()}`;

      case this.strings.branch_delete_recreate:
        try {
          // Check if local branch exists and delete it
          const localExists = await this.gitUtils.localBranchExists(branchName);
          if (localExists) {
            const currentBranch = await this.gitUtils.getCurrentBranch();
            if (currentBranch === branchName) {
              await this.gitUtils.checkout("main");
            }
            await this.gitUtils.deleteBranchSafely(branchName, true);
          }

          // Delete remote branch if it exists
          const remoteExists =
            await this.gitUtils.remoteBranchExists(branchName);
          if (remoteExists) {
            await this.gitUtils.deleteRemoteBranch(branchName);
          }
          return branchName;
        } catch (error: any) {
          await this.gitUtils.performCleanup({
            branch: branchName,
            originalBranch: await this.gitUtils.getCurrentBranch(),
            force: true,
          });
          const newName = `${branchName}-${Date.now()}`;
          vscode.window.showWarningMessage(
            this.strings.error_branch_delete_current.replace("{0}", newName),
          );
          return newName;
        }

      case this.strings.branch_cancel:
      default:
        return null;
    }
  }

  private async handleCherryPickConflict(branchName: string): Promise<boolean> {
    try {
      await this.stateService.updateCherryPickState({
        inProgress: true,
        branch: branchName,
        hasConflicts: true,
      });

      const conflictedFiles = await this.gitUtils.getConflictedFiles();
      if (conflictedFiles.length === 0) {
        return true;
      }

      const resolved = await this.resolveConflicts(conflictedFiles);
      return resolved;
    } catch (error) {
      console.error(this.strings.error_unknown, error);
      await this.gitUtils.performCleanup({
        branch: branchName,
        originalBranch: await this.gitUtils.getCurrentBranch(),
        force: true,
      });
      await this.stateService.updateCherryPickState({
        inProgress: false,
        hasConflicts: false,
      });
      return false;
    }
  }

  private async resolveConflicts(files: string[]): Promise<boolean> {
    try {
      // Remove duplicate prompt and just handle the resolution flow
      await this.openConflictedFiles(files);
      const resolution = await this.waitForConflictResolution(files);

      if (resolution === "continue") {
        // Stage resolved files
        await this.gitUtils.addAll();

        // Continue cherry-pick
        await this.gitUtils.cherryPickContinue();

        await this.stateService.updateCherryPickState({
          inProgress: false,
          hasConflicts: false,
        });

        vscode.window.showInformationMessage(this.strings.success_title);
        return true;
      } else {
        await this.gitUtils.abortCherryPick();
        await this.stateService.updateCherryPickState({
          inProgress: false,
          hasConflicts: false,
        });
        return false;
      }
    } catch (error) {
      console.error(this.strings.error_cherry_pick_failed, error);
      await this.gitUtils.abortCherryPick();
      await this.stateService.updateCherryPickState({
        inProgress: false,
        hasConflicts: false,
      });
      return false;
    }
  }

  private async waitForConflictResolution(
    files: string[],
  ): Promise<"continue" | "cancel"> {
    const disposables: vscode.Disposable[] = [];
    const watchers: vscode.FileSystemWatcher[] = [];

    try {
      // Initial prompt to resolve conflicts
      const shouldResolve = await vscode.window.showInformationMessage(
        this.strings.conflict_resolve_message,
        { modal: true },
        this.strings.yes,
        this.strings.no,
      );

      if (shouldResolve !== this.strings.yes) {
        return "cancel";
      }

      return await new Promise((resolve) => {
        let isPromptShowing = false;

        // Watch for changes in conflicted files
        watchers.push(
          ...files.map((file) =>
            vscode.workspace.createFileSystemWatcher(
              new vscode.RelativePattern(
                this.workspaceService.workspacePath,
                file,
              ),
            ),
          ),
        );

        // Only show completion prompt after save
        disposables.push(
          vscode.workspace.onDidSaveTextDocument(async (doc) => {
            if (
              !isPromptShowing &&
              files.some((f) => doc.uri.fsPath.endsWith(f))
            ) {
              isPromptShowing = true;

              const choice = await vscode.window.showInformationMessage(
                this.strings.conflict_resolution_prompt, // Different message for completion
                {
                  modal: true,
                  detail: this.strings.conflict_resolution_detail,
                },
                this.strings.conflict_resolved,
                this.strings.conflict_continue_editing,
                this.strings.conflict_abort,
              );

              if (choice === this.strings.conflict_resolved) {
                resolve("continue");
              } else if (choice === this.strings.conflict_abort) {
                resolve("cancel");
              }
              isPromptShowing = false;
            }
          }),
        );
      });
    } finally {
      disposables.forEach((d) => d.dispose());
      watchers.forEach((w) => w.dispose());
    }
  }

  private async openConflictedFiles(files: string[]): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.scm");

    const extensionView = vscode.window.activeTextEditor;

    for (const file of files) {
      try {
        const uri = vscode.Uri.file(
          path.join(this.workspaceService.workspacePath, file),
        );
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Active,
          preserveFocus: true,
          preview: false,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(this.strings.error_unknown.replace("{0}", file), error);
      }
    }

    if (extensionView) {
      await vscode.window.showTextDocument(extensionView.document, {
        viewColumn: extensionView.viewColumn,
        preserveFocus: false,
      });
    }
  }
}
