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
  | "webviewReady"
  | "validatePrUrl";

  // figure out what to do about status and success on cherrypickstate
  export interface StateData {
    savedVersions: { [key: string]: string[] };
    savedRepos: string[];
    lastUpdated: number;
    pendingOperations: {
      cherryPick?: CherryPickState;
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


export interface BranchCreationResult {
  success: boolean;
  hasConflicts: boolean;
  conflictedFiles?: string[];
  error?: string;
  resolutionInProgress?: boolean;
}

export interface CherryPickState {
  inProgress: boolean;
  branch: string;
  commit?: string;
  hasConflicts: boolean;
  files?: string[];
  success?: boolean;
}

export interface ConflictFile {
  path: string;
  resolved: boolean;
}
