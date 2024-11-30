import { exec } from "child_process";
import * as vscode from "vscode";
import { WorkspaceService } from "../services/workspaceService";
import { LanguageService } from "../services/languageService";
import { CleanupState, GitHubUser } from "../types";
export class GitUtils {
  private readonly strings: Record<string, string>;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly languageService: LanguageService,
  ) {
    this.strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );
  }

  async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const workspacePath = this.workspaceService.workspacePath;

        // Only log non-sensitive commands
        if (!command.includes("--abort")) {
          console.log({ command, workspacePath });
        }

        exec(
          command,
          {
            cwd: workspacePath,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
          (error, stdout, stderr) => {
            if (error) {
              // Check for expected error cases
              const expectedErrors = [
                "no cherry-pick or revert in progress",
                "could not apply",
                "needs merge",
                'hint: run "git cherry-pick --abort"',
              ];

              const isExpectedError = expectedErrors.some(
                (msg) =>
                  stderr.includes(msg) || command.includes("cherry-pick"),
              );

              if (!isExpectedError) {
                console.error("Command execution failed:", {
                  error: error.message,
                  stderr,
                });
              }

              const err = new Error(
                `Command failed: ${stderr || error.message}`,
              );
              (err as any).stderr = stderr;
              reject(err);
              return;
            }

            // Only log output for non-abort commands
            if (!command.includes("--abort")) {
              console.log("Command output:", stdout);
            }
            resolve(stdout.trim());
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async checkIfMergeCommit(commitHash: string): Promise<boolean> {
    try {
      const parents = await this.execCommand(
        `git rev-list --parents -n 1 ${commitHash}`,
      );
      const parentHashes = parents.trim().split(" ");
      return parentHashes.length > 2;
    } catch (error) {
      console.error("Error checking if commit is a merge commit:", error);
      return false;
    }
  }

  async validateGitRepo(): Promise<boolean> {
    try {
      console.log("Validating git repository...");
      console.log("Current workspace:", this.workspaceService.workspacePath);

      const gitStatus = await this.execCommand("git status");
      console.log("Git status:", gitStatus);

      return true;
    } catch (error: any) {
      console.error("Git validation error:", error);
      vscode.window.showErrorMessage(
        this.strings.git_error_validation.replace("{0}", error),
      );
      return false;
    }
  }

  async remoteBranchExists(branchName: string): Promise<boolean> {
    try {
      const cleanBranchName = this.normalizeBranchName(branchName);
      const remoteCheck = await this.execCommand(
        `git ls-remote --heads origin ${cleanBranchName}`,
      )
        .then((output) => output.length > 0)
        .catch(() => false);

      console.log("Remote branch check:", {
        branchName,
        cleanBranchName,
        exists: remoteCheck,
        method: "ls-remote",
      });

      return remoteCheck;
    } catch (error) {
      console.error("Error checking remote branch:", error);
      return false;
    }
  }

  async localBranchExists(branchName: string): Promise<boolean> {
    try {
      const cleanBranchName = this.normalizeBranchName(branchName);
      const localBranches = await this.execCommand("git branch --list");
      const exists = localBranches
        .split("\n")
        .map((b) => b.replace("*", "").trim())
        .some((b) => b === cleanBranchName);

      console.log("Local branch check:", {
        branchName,
        cleanBranchName,
        exists,
        branches: localBranches.split("\n").map((b) => b.trim()),
      });

      return exists;
    } catch (error) {
      console.error("Error checking local branch:", error);
      return false;
    }
  }

  async branchExists(
    branchName: string,
    checkRemote: boolean = true,
  ): Promise<boolean> {
    const [localExists, remoteExists] = await Promise.all([
      this.localBranchExists(branchName),
      checkRemote
        ? this.remoteBranchExists(branchName)
        : Promise.resolve(false),
    ]);

    console.log("Branch existence check:", {
      branchName,
      localExists,
      remoteExists,
      checkRemote,
    });

    return localExists || (checkRemote && remoteExists);
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const branchName = await this.execCommand(
        "git rev-parse --abbrev-ref HEAD",
      );
      const cleanBranchName = this.normalizeBranchName(branchName);

      console.log("Current branch check:", {
        original: branchName,
        normalized: cleanBranchName,
      });

      return cleanBranchName;
    } catch (error) {
      console.error("Error getting current branch:", error);
      throw new Error(this.strings.git_error_branch);
    }
  }

  async abortCherryPick(): Promise<void> {
    try {
      await this.execCommand("git cherry-pick --abort");
      console.log("Cherry-pick abort successful");
    } catch (error) {
      // Don't throw since abort is typically called in cleanup scenarios
      console.error("Error aborting cherry-pick:", error);
    }
  }

  private normalizeBranchName(branchName: string): string {
    return branchName
      .replace("refs/heads/", "")
      .replace("refs/remotes/origin/", "")
      .replace("origin/", "")
      .trim();
  }

  async getBranchNameFromCommit(commitHash: string): Promise<string> {
    try {
      const commitMsg = await this.execCommand(
        `git log -1 --pretty=format:%s ${commitHash}`,
      );
      const mergePRMatch = commitMsg.match(
        /Merge pull request #\d+ from [\w-]+\/([\w\/-]+)/,
      );

      if (mergePRMatch) {
        return mergePRMatch[1];
      }

      const branchName = await this.execCommand(
        `git name-rev --name-only ${commitHash}`,
      );
      return branchName
        .trim()
        .replace("remotes/origin/", "")
        .replace("tags/", "")
        .split("~")[0]
        .split("^")[0];
    } catch (error) {
      console.error("Error getting branch name:", error);
      return "cherry-pick";
    }
  }

  async checkout(branch: string): Promise<void> {
    await this.execCommand(`git checkout ${branch}`);
  }

  async createBranch(branchName: string): Promise<void> {
    await this.execCommand(`git checkout -b ${branchName}`);
  }

  async cherryPick(
    commitHash: string,
    isMergeCommit: boolean = false,
  ): Promise<void> {
    const cmd = isMergeCommit
      ? `git cherry-pick -m 1 ${commitHash}`
      : `git cherry-pick ${commitHash}`;
    await this.execCommand(cmd);
  }

  async fetchAll(): Promise<void> {
    await this.execCommand("git fetch --all");
  }

  async push(branch: string): Promise<void> {
    await this.execCommand(`git push -u origin ${branch}`);
  }

  async deleteBranch(
    branchName: string,
    force: boolean = false,
  ): Promise<void> {
    const flag = force ? "-D" : "-d";
    await this.execCommand(`git branch ${flag} ${branchName}`);
  }

  async deleteRemoteBranch(branchName: string): Promise<void> {
    await this.execCommand(`git push origin --delete ${branchName}`);
  }

  async resetHard(): Promise<void> {
    await this.execCommand("git reset --hard");
  }

  async addAll(): Promise<void> {
    await this.execCommand("git add .");
  }

  async getRemoteUrl(): Promise<string> {
    try {
      return await this.execCommand("git remote get-url origin");
    } catch (error) {
      console.error("Error getting remote URL:", error);
      throw new Error(this.strings.git_error_remote_url);
    }
  }

  async cherryPickContinue(): Promise<void> {
    await this.execCommand("git cherry-pick --continue");
  }

  async getStatus(): Promise<string> {
    return this.execCommand("git status");
  }

  async validateCommitExists(commitHash: string): Promise<boolean> {
    return this.execCommand(`git cat-file -t ${commitHash}`)
      .then(() => true)
      .catch(() => false);
  }

  async getConflictedFiles(): Promise<string[]> {
    const output = await this.execCommand(
      "git diff --name-only --diff-filter=U",
    );
    return output.split("\n").filter((file) => file.trim());
  }

  async viewRepo(repoName: string): Promise<void> {
    await this.execCommand(`gh repo view ${repoName}`);
  }

  async getCurrentUser(): Promise<string> {
    return this.execCommand("gh api user --jq .login");
  }

  async getCollaboratorPermission(
    repoName: string,
    username: string,
  ): Promise<string> {
    const cmd = `gh api repos/${repoName}/collaborators/${username.trim()}/permission --jq .permission`;
    return this.execCommand(cmd);
  }

  async getOrgMembership(org: string, username: string): Promise<string> {
    const cmd = `gh api orgs/${org}/memberships/${username.trim()} --jq .state`;
    return this.execCommand(cmd);
  }

  async getPrData(prNumber: string, repoName: string): Promise<string> {
    const cmd = `gh pr view ${prNumber} --repo ${repoName} --json title,body`;
    return this.execCommand(cmd);
  }

  async createPr(options: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<string> {
    const cmd = `gh pr create --repo ${options.repo} \
            --head ${options.head} \
            --base ${options.base} \
            --title "${options.title}" \
            --body "${options.body}"`;
    return this.execCommand(cmd);
  }

  async editPr(options: {
    number: string;
    repo: string;
    assignee?: string;
    reviewer?: string;
    state?: string;
    body?: string;
  }): Promise<void> {
    if (options.state) {
      await this.execCommand(
        `gh pr edit ${options.number} --repo ${options.repo} --state ${options.state}`,
      );
    }

    if (options.body) {
      // Escape newlines and quotes for shell
      const escapedBody = options.body
        .replace(/"/g, '\\"')
        .replace(/`/g, "\\`");

      await this.execCommand(
        `gh pr edit ${options.number} --repo ${options.repo} --body "${escapedBody}"`,
      );
    }

    if (options.assignee) {
      const assignCmd =
        options.assignee === "@self"
          ? `gh pr edit ${options.number} --repo ${options.repo} --add-assignee "@me"`
          : `gh pr edit ${options.number} --repo ${options.repo} --add-assignee "${options.assignee.substring(1)}"`;
      await this.execCommand(assignCmd);
    }

    if (options.reviewer) {
      await this.execCommand(
        `gh pr edit ${options.number} --repo ${options.repo} --add-reviewer "${options.reviewer.substring(1)}"`,
      );
    }
  }

  async listPrs(options: {
    repo: string;
    state?: string;
    head?: string;
    search?: string;
    format?: string;
  }): Promise<string> {
    let cmd = `gh pr list --repo ${options.repo}`;
    if (options.state) {
      cmd += ` --state ${options.state}`;
    }
    if (options.head) {
      cmd += ` --head ${options.head}`;
    }
    if (options.search) {
      cmd += ` --search "${options.search}"`;
    }
    if (options.format) {
      cmd += ` --json ${options.format}`;
    }
    return this.execCommand(cmd);
  }

  async getRepoCollaborators(repoName: string): Promise<string[]> {
    const command = `gh api repos/${repoName}/collaborators --jq '.[].login'`;
    const output = await this.execCommand(command);
    return output.split("\n").filter((user) => user.trim());
  }

  async getOrgMembers(org: string): Promise<string[]> {
    const command = `gh api orgs/${org}/members --jq '.[].login'`;
    const output = await this.execCommand(command);
    return output.split("\n").filter((user) => user.trim());
  }

  async validatePrUrl(prUrl: string): Promise<boolean> {
    try {
      const urlMatch = prUrl.match(
        /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
      );
      if (!urlMatch) {
        return false;
      }

      const [, owner, repo, prNumber] = urlMatch;
      const fullRepoName = `${owner}/${repo}`;

      // Check if PR exists using GitHub CLI
      await this.execCommand(`gh pr view ${prNumber} --repo ${fullRepoName}`);
      return true;
    } catch (error) {
      console.error("Error validating PR URL:", error);
      return false;
    }
  }

  async getFullRepoName(repoName: string): Promise<string> {
    if (repoName.includes("/")) {
      return repoName;
    }

    try {
      const orgs = await this.getOrgs().catch(() => {
        throw new Error(this.strings.git_error_user_orgs);
      });

      for (const org of orgs) {
        try {
          await this.viewRepo(`${org}/${repoName}`);
          return `${org}/${repoName}`;
        } catch {
          continue;
        }
      }

      const userName = await this.getCurrentUser().catch(() => {
        throw new Error(this.strings.git_error_user_name);
      });
      const fullRepoName = `${userName}/${repoName}`;

      try {
        await this.viewRepo(fullRepoName);
        return fullRepoName;
      } catch {
        throw new Error(
          this.strings.git_error_repo_access.replace("{0}", fullRepoName),
        );
      }
    } catch (error: any) {
      if (
        error.message.includes(this.strings.git_error_user_orgs) ||
        error.message.includes(this.strings.git_error_user_name)
      ) {
        throw error;
      }
      throw new Error(
        this.strings.git_error_repo_name.replace("{0}", repoName),
      );
    }
  }

  private async getOrgs(): Promise<string[]> {
    const command = `gh api /user/memberships/orgs --jq '.[].organization.login'`;
    const output = await this.execCommand(command);
    return output.split("\n").filter((org) => org.trim());
  }

  async deleteBranchSafely(branchName: string, force: boolean) {
    if (branchName === "main" || branchName === "master") {
      throw new Error("Cannot delete main/master branch");
    }
    await this.deleteBranch(branchName, force);
  }

  async performCleanup(state: CleanupState): Promise<void> {
    try {
      // 1. Abort any in-progress operations
      const status = await this.getStatus();
      if (status.includes("cherry-pick")) {
        await this.abortCherryPick();
      }

      // 2. Reset working directory
      await this.resetHard();

      // 3. Delete local branch - with safety check
      if (await this.localBranchExists(state.branch)) {
        const currentBranch = await this.getCurrentBranch();
        if (currentBranch === state.branch) {
          await this.checkout("main");
        }
        await this.deleteBranchSafely(state.branch, state.force ?? true);
      }

      // 4. Delete remote branch if exists
      if (state.remoteBranch) {
        const remoteExists = await this.remoteBranchExists(state.branch);
        if (remoteExists) {
          await this.deleteRemoteBranch(state.branch);
        }
      }

      // 5. Close PR if exists
      if (state.pr?.number && state.pr?.repo) {
        await this.editPr({
          ...state.pr,
          state: "closed",
        });
      }

      // 6. Restore original branch
      await this.checkout(state.originalBranch);
    } catch (error) {
      console.error("Cleanup failed:", error);
      throw new Error(this.strings.cleanup_failed);
    }
  }

  async fetchGitHubUsers(repoName: string): Promise<GitHubUser[]> {
    try {
      const [owner] = repoName.split("/");
      const currentUser = await this.getCurrentUser();
      const isPersonalRepo = owner.trim() === currentUser.trim();
      let users: GitHubUser[] = [];

      if (isPersonalRepo) {
        const collaborators = await this.getRepoCollaborators(repoName);
        users = [
          { label: currentUser.trim(), type: "user" as const },
          ...collaborators.map((c) => ({ label: c, type: "user" as const })),
        ];
      } else {
        try {
          const orgMembers = await this.getOrgMembers(owner);
          const collaborators = await this.getRepoCollaborators(repoName);
          const teams = await this.getOrgTeams(owner);

          users = [
            ...orgMembers.map((c) => ({ label: c, type: "user" as const })),
            ...collaborators.map((c) => ({ label: c, type: "user" as const })),
            ...teams.map((t) => ({ label: t, type: "team" as const })),
          ];
        } catch (error) {
          const collaborators = await this.getRepoCollaborators(repoName);
          users = collaborators.map((c) => ({
            label: c,
            type: "user" as const,
          }));
        }
      }

      // Type guard for the Set operation
      const uniqueUsers = [...new Set(users.map((u) => JSON.stringify(u)))].map(
        (u) => {
          const parsed = JSON.parse(u);
          return {
            label: parsed.label,
            type: parsed.type as "user" | "team",
          };
        },
      );

      return uniqueUsers;
    } catch (error: any) {
      throw new Error(
        `${this.strings.pr_fetch_github_users_failed}: ${error.message}`,
      );
    }
  }

  async getOrgTeams(org: string): Promise<string[]> {
    try {
      const result = await this.execCommand(
        `gh api orgs/${org}/teams --jq '.[].slug'`,
      );
      return result.split("\n").filter(Boolean);
    } catch (error: any) {
      console.error("Failed to fetch org teams:", error);
      return [];
    }
  }

  async getDefaultBranch(repoName: string): Promise<string> {
    try {
      const defaultBranch = await this.execCommand(
        `gh api repos/${repoName} --jq .default_branch`,
      );
      return defaultBranch.trim();
    } catch (error: any) {
      console.error("Error getting default branch:", error);
      // Fallback to 'main' or 'master'
      try {
        const hasMaster = await this.branchExists("master", true);
        return hasMaster ? "master" : "main";
      } catch {
        return "main"; // Final fallback
      }
    }
  }
}
