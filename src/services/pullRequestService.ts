import * as vscode from "vscode";
import { GitUtils } from "../utils/git";
import { PRData } from "../types";
import { LanguageService } from "./languageService";

export class PullRequestService {
  private validatedRepoName: string;
  private strings: any;

  constructor(
    private repoName: string,
    private gitUtils: GitUtils,
    private languageService: LanguageService,
  ) {
    this.repoName = repoName;
    this.validatedRepoName = "";
    this.strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );
  }

  async init(): Promise<void> {
    const originalBranch = await this.gitUtils.getCurrentBranch();
    try {
      // Let RepoService handle both simple and full repo names
      const fullRepoName = await this.gitUtils.getFullRepoName(this.repoName);
      // Validate access after getting full name
      this.validatedRepoName =
        await this.validateRepositoryAccess(fullRepoName);
    } catch (error: any) {
      await this.gitUtils.performCleanup({
        branch: await this.gitUtils.getCurrentBranch(),
        originalBranch,
        force: true,
      });
      const errorMessage = this.strings.pr_init_failed.replace(
        "{0}",
        error.message,
      );
      throw new Error(errorMessage);
    }
  }

  private async validateRepositoryAccess(repoName: string): Promise<string> {
    const originalBranch = await this.gitUtils.getCurrentBranch();
    try {
      // Check if repo exists
      await this.gitUtils.viewRepo(repoName);

      // Get current user
      const currentUser = await this.gitUtils.getCurrentUser();
      const [owner] = repoName.split("/");

      // User is owner
      if (owner.trim() === currentUser.trim()) {
        return repoName;
      }

      // Check collaborator permissions
      try {
        const permission = await this.gitUtils.getCollaboratorPermission(
          repoName,
          currentUser.trim(),
        );
        if (
          ["admin", "write", "maintain"].some((level) =>
            permission.includes(level),
          )
        ) {
          return repoName;
        }
      } catch {
        // Try org membership if collaborator check fails
        const [org] = repoName.split("/");
        const memberStatus = await this.gitUtils.getOrgMembership(
          org,
          currentUser.trim(),
        );
        if (memberStatus.includes("active")) {
          return repoName;
        }
      }

      throw new Error(
        this.strings.pr_invalid_repo_permissions.replace("{0}", repoName),
      );
    } catch (error: any) {
      await this.gitUtils.performCleanup({
        branch: await this.gitUtils.getCurrentBranch(),
        originalBranch,
        force: true,
      });
      if (
        error.message.includes(
          this.strings.pr_invalid_repo_permissions.replace("{0}", ""),
        )
      ) {
        throw error;
      }
      throw new Error(
        this.strings.pr_validation_failed.replace("{0}", error.message),
      );
    }
  }

  async createPullRequest(
    prUrl: string,
    newBranch: string,
    version: string,
  ): Promise<void> {
    if (!this.validatedRepoName) {
      await this.init();
    }

    const originalBranch = await this.gitUtils.getCurrentBranch();

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.strings.pr_creating_title,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          // Add cancellation handler
          token.onCancellationRequested(async () => {
            await this.gitUtils.performCleanup({
              branch: newBranch,
              originalBranch,
              force: true,
            });
            throw new Error(this.strings.pr_cancelled);
          });

          progress.report({
            message: this.strings.pr_fetching_data,
            increment: 20,
          });
          const prData = await this.fetchPullRequestData(prUrl);

          progress.report({
            message: this.strings.pr_generating_title,
            increment: 20,
          });
          const newPrTitle = `${prData.title} (${version})`;

          progress.report({ message: this.strings.pr_creating, increment: 60 });
          await this.createGitHubPullRequest(
            newBranch,
            newPrTitle,
            prData.body,
            version,
          );
        } catch (error: any) {
          // Cleanup on any error
          await this.gitUtils.performCleanup({
            branch: newBranch,
            originalBranch,
            force: true,
          });

          if (token.isCancellationRequested) {
            throw new Error(this.strings.pr_cancelled);
          }
          throw error;
        }
      },
    );
  }

  private async fetchPullRequestData(prUrl: string): Promise<PRData> {
    const originalBranch = await this.gitUtils.getCurrentBranch();
    try {
      const urlMatch = prUrl.match(
        /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
      );
      if (!urlMatch) {
        throw new Error(this.strings.pr_url_invalid);
      }

      const [, owner, repo, prNumber] = urlMatch;
      const fullRepoName = `${owner}/${repo}`;

      if (!this.validateRepoFormat(this.repoName)) {
        throw new Error(
          this.strings.pr_invalid_repo_format.replace("{0}", this.repoName),
        );
      }

      await this.gitUtils.viewRepo(fullRepoName);
      const prDataRaw = await this.gitUtils.getPrData(prNumber, fullRepoName);

      try {
        const prData: PRData = JSON.parse(prDataRaw);
        if (!prData.title || !prData.body) {
          throw new Error(this.strings.pr_no_title_body);
        }
        return prData;
      } catch (error) {
        throw new Error(
          this.strings.pr_parse_error.replace("{0}", (error as any).message),
        );
      }
    } catch (error: any) {
      await this.gitUtils.performCleanup({
        branch: await this.gitUtils.getCurrentBranch(),
        originalBranch,
        force: true,
      });
      const message = error.message.includes(
        'expected the "[HOST/]OWNER/REPO" format',
      )
        ? this.strings.pr_invalid_repo_format
        : error.message;
      throw new Error(message);
    }
  }

  private async createGitHubPullRequest(
    branch: string,
    title: string,
    body: string,
    version: string,
  ): Promise<void> {
    const originalBranch = await this.gitUtils.getCurrentBranch();
    const defaultBranch = await this.gitUtils.getDefaultBranch(
      this.validatedRepoName,
    );
    let prCreatedSuccessfully = false;

    try {
      await this.gitUtils.push(branch);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const newPrUrl = await this.gitUtils.createPr({
        repo: this.validatedRepoName,
        head: branch,
        base: version,
        title: title,
        body: body,
      });

      const newPrNumber = newPrUrl.trim().split("/").pop() || "";
      if (newPrNumber) {
        // Handle assignee
        const assignee = await this.handlePRAssignment();
        if (assignee) {
          await this.gitUtils.editPr({
            number: newPrNumber,
            repo: this.validatedRepoName,
            assignee: assignee,
          });
        }

        // Handle reviewer
        const reviewer = await this.selectReviewer();
        if (reviewer) {
          await this.gitUtils.editPr({
            number: newPrNumber,
            repo: this.validatedRepoName,
            reviewer: reviewer,
          });
        }
      }
      prCreatedSuccessfully = true;
    } catch (error: any) {
      await this.gitUtils.performCleanup({
        branch,
        originalBranch,
        force: true,
      });
      throw new Error(`${this.strings.pr_creation_failed}: ${error.message}`);
    } finally {
      if (prCreatedSuccessfully) {
        // Checkout original branch after successful PR creation
        await this.gitUtils.checkout(defaultBranch);
      }
    }
  }

  private async handleUserSelection(
    selectionType: "reviewer" | "assignee",
    attempt: number = 1,
  ): Promise<string | undefined> {
    try {
      const users = await this.gitUtils.fetchGitHubUsers(
        this.validatedRepoName,
      );
      const selection = await vscode.window.showQuickPick(
        users.map((user) => ({
          label: `@${user.label}`,
          description: user.type === "team" ? "Team" : "User",
          type: user.type,
        })),
        {
          placeHolder:
            selectionType === "reviewer"
              ? this.strings.pr_select_reviewer
              : this.strings.pr_select_assignee,
        },
      );

      if (!selection && attempt < 3) {
        const retry = await vscode.window.showQuickPick(
          [
            {
              label: this.strings.retry,
              description: this.strings.retry_selection,
            },
            {
              label: this.strings.cancel,
              description: this.strings.skip_selection,
            },
          ],
          {
            placeHolder: this.strings.selection_cancelled.replace(
              "{0}",
              selectionType,
            ),
          },
        );

        if (retry?.label === this.strings.retry) {
          return this.handleUserSelection(selectionType, attempt + 1);
        }
      }

      return selection?.label;
    } catch (error: any) {
      vscode.window.showErrorMessage(error.message);
      return undefined;
    }
  }

  private async selectReviewer(): Promise<string | undefined> {
    return this.handleUserSelection("reviewer");
  }

  private async handlePRAssignment(): Promise<string | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        {
          label: this.strings.pr_self_assign_yes,
          description: this.strings.pr_self_assign_yes_desc,
        },
        {
          label: this.strings.pr_self_assign_no,
          description: this.strings.pr_self_assign_no_desc,
        },
      ],
      { placeHolder: this.strings.pr_self_assign_prompt },
    );

    if (selection?.label === this.strings.pr_self_assign_yes) {
      return "@self";
    }

    return this.handleUserSelection("assignee");
  }

  private validateRepoFormat(repoName: string): boolean {
    return true;
  }
}
