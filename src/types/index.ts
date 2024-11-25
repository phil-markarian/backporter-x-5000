export interface PRData {
    title: string;
    body: string;
}

export interface VersionPrUrls {
    [version: string]: string;
}

export interface GitCommandOptions {
    showOutput?: boolean;
    throwOnError?: boolean;
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
    | 'error' 
    | 'test'
    | 'loadSavedVersions'
    | 'deleteVersion'
    | 'formSubmit'
    | 'getLanguageString'
    | 'languageChange'
    | 'languageString'
    | 'languageChangeComplete'
    | 'savedVersions'
    | 'success'
    | 'loading'
    | 'validationError'
    | 'webviewReady';

export type LanguageMessage = {
    type: 'languageChange' | 'getLanguageString';
    payload: {
        language?: string;
        key?: string;
        keys?: string[];
    };
};

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
            status: 'pending' | 'success' | 'failed';
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
}