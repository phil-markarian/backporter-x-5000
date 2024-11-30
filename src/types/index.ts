export interface PRData {
  title: string;
  body: string;
}

export interface SavedVersions {
  [key: string]: string[];
}

// types.ts
export interface WebviewMessage {
  type: MessageType;
  payload?: any;
  key?: string;
  value?: string;
}

export type MessageType =
  | "error"
  | "test"
  | "loadSavedVersions"
  | "deleteVersion"
  | "formSubmit"
  | "getLanguageString"
  | "languageChange"
  | "languageString"
  | "languageChangeComplete"
  | "savedVersions"
  | "success"
  | "loading"
  | "validationError"
  | "webviewReady";

export interface StateData {
  savedVersions: { [key: string]: string[] };
  savedRepos: string[];
  lastUpdated: number;
  pendingOperations: {
    cherryPick?: {
      inProgress: boolean;
      branch: string;
      commit: string;
      hasConflicts: boolean;
    };
    branchCreation?: {
      status: "pending" | "success" | "failed";
      error?: string;
    };
  };
}

export interface PRInfo {
  title?: string;
  body?: string;
}

export interface PendingBranch {
  repoName: string;
  versions: string[];
  commitHash: string;
}

export interface BackportFormData {
  newRepoName: string;
  repoName: string;
  versions: string;
  cherryPickCommit: string;
  prUrl: string;
}

export interface PendingBranch {
  repoName: string;
  version: string;
  cherryPickCommit: string;
  newBranch: string;
  prUrl: string;
}

export interface WebviewState {
  initialized: boolean;
  currentLanguage: string;
  strings: Record<string, string>;
}

export interface CleanupState {
  branch: string;
  originalBranch: string;
  remoteBranch?: boolean;
  pr?: {
    number: string;
    repo: string;
  };
  force?: boolean;
}

export interface GitHubUser {
  label: string;
  type: "user" | "team";
}

export interface BackportedPR {
  version: string;
  url: string;
  number: string;
}
