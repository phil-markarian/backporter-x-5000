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

export interface WebviewMessage {
    type: string;
    payload?: any;
}

export interface SavedVersions {
    [key: string]: string[];
}

export type MessageType = 'error' | 'test' | 'loadSavedVersions' | 'deleteVersion' | 'formSubmit';

export interface StateData {
    savedVersions: SavedVersions;
    savedRepos: string[];
    lastUpdated?: number;
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