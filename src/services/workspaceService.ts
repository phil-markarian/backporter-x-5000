import * as vscode from 'vscode';

export class WorkspaceService {
    private static instance: WorkspaceService;
    private _workspacePath: string | undefined;

    private constructor() {
        this.initWorkspacePath();
    }

    static getInstance(): WorkspaceService {
        if (!WorkspaceService.instance) {
            WorkspaceService.instance = new WorkspaceService();
        }
        return WorkspaceService.instance;
    }

    private initWorkspacePath() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this._workspacePath = workspaceFolders[0].uri.fsPath;
        }
    }

    get workspacePath(): string {
        if (!this._workspacePath) {
            throw new Error('No workspace folder open');
        }
        return this._workspacePath;
    }
}