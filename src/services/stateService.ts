import * as vscode from 'vscode';
import { StateData, WebviewMessage, MessageType, PendingBranch} from '../types';
import { GitUtils } from '../utils/git';

export class StateService {
    private state: StateData;
    private readonly stateChangeEmitter = new vscode.EventEmitter<StateData>();
    private readonly branchCreationEmitter = new vscode.EventEmitter<PendingBranch>();
    
    readonly onStateChanged = this.stateChangeEmitter.event;
    readonly onBranchCreationRequested = this.branchCreationEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly gitUtils: GitUtils
    ) {
        this.state = this.initializeState();
    }

    private initializeState(): StateData {
        return {
            savedVersions: this.context.globalState.get('savedVersions', {}),
            savedRepos: this.context.globalState.get('savedRepos', []),
            lastUpdated: Date.now(),
            pendingOperations: {}
        };
    }

    async handleMessage(message: WebviewMessage, panel?: vscode.WebviewPanel): Promise<void> {
        try {
            switch (message.type as MessageType) {
                case 'error':
                    await this.handleError(message);
                    break;
                case 'test':
                    this.handleTest(message);
                    break;
                case 'loadSavedVersions':
                    await this.handleLoadSavedVersions(message, panel!);
                    break;
                case 'deleteVersion':
                    await this.handleDeleteVersion(message, panel!);
                    break;
                case 'formSubmit':
                    await this.handleFormSubmit(message);
                    break;
                default:
                    console.error('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }

    private async handleError(message: WebviewMessage): Promise<void> {
        vscode.window.showErrorMessage(String(message.payload));
    }

    private handleTest(message: WebviewMessage): void {
        console.log('Test message received:', message.payload);
    }

    private async handleLoadSavedVersions(message: WebviewMessage, panel: vscode.WebviewPanel): Promise<void> {
        // Add null check and default value for payload
        const repoName = message?.payload?.repoName;
        if (!repoName) {
            throw new Error('Repository name is required');
        }
    
        const versions = await this.getSavedVersions(repoName);
        panel.webview.postMessage({
            type: 'savedVersions',
            versions
        });
    }

    private async handleDeleteVersion(message: WebviewMessage, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const { repoName, version } = message.payload;
            
            if (!repoName?.trim() || !version?.trim()) {
                throw new Error('Repository name and version cannot be empty');
            }
    
            // Delete version directly from state
            if (this.state.savedVersions[repoName]) {
                this.state.savedVersions[repoName] = this.state.savedVersions[repoName]
                    .filter(v => v !== version);
                await this.saveState();
            }
    
            // Update webview with new versions
            panel.webview.postMessage({
                type: 'savedVersions',
                versions: this.state.savedVersions[repoName] || []
            });
        } catch (error) {
            console.error('Error deleting version:', error);
            throw error;
        }
    }

    async saveRepo(repoName: string): Promise<void> {
        if (!repoName?.trim()) {
            throw new Error('Repository name cannot be empty');
        }

        if (!this.state.savedRepos.includes(repoName)) {
            this.state.savedRepos.push(repoName);
            await this.saveState();
        }
    }

    async deleteRepo(repoName: string): Promise<void> {
        this.state.savedRepos = this.state.savedRepos.filter(r => r !== repoName);
        delete this.state.savedVersions[repoName];
        await this.saveState();
    }

    async getSavedRepos(): Promise<string[]> {
        return [...this.state.savedRepos];
    }

    async saveVersions(repoName: string, versions: string[]): Promise<void> {
        if (!repoName?.trim()) {
            throw new Error('Repository name cannot be empty');
        }

        const uniqueVersions = Array.from(new Set(versions.filter(Boolean)));
        this.state.savedVersions[repoName] = uniqueVersions;
        await this.saveState();
    }

    async getSavedVersions(repoName: string): Promise<string[]> {
        return [...(this.state.savedVersions[repoName] || [])];
    }

    private async saveState(): Promise<void> {
        await Promise.all([
            this.context.globalState.update('savedVersions', this.state.savedVersions),
            this.context.globalState.update('savedRepos', this.state.savedRepos)
        ]);
        this.state.lastUpdated = Date.now();
        this.stateChangeEmitter.fire(this.state);
    }
    

    private async handleFormSubmit(message: WebviewMessage): Promise<void> {
        if (!await this.gitUtils.validateGitRepo()) {
            throw new Error('Not a valid git repository');
        }

        const { repoName, newRepoName, versions, cherryPickCommit } = message.payload;
        const finalRepoName = newRepoName.trim() || repoName;

        if (!finalRepoName) {
            throw new Error('Repository name is required');
        }

        if (newRepoName.trim()) {
            await this.saveRepo(newRepoName.trim());
        }

        const inputVersions = versions.split(',')
            .map((v: string) => v.trim())
            .filter(Boolean);

        if (inputVersions.length === 0) {
            throw new Error('At least one version is required');
        }

        await this.saveVersions(finalRepoName, inputVersions);

        const pendingBranch: PendingBranch = {
            repoName: finalRepoName,
            versions: inputVersions,
            commitHash: cherryPickCommit
        };

        this.branchCreationEmitter.fire(pendingBranch);
        await this.context.workspaceState.update('pendingBranches', pendingBranch);
    }

    private updateOperationState(update: Partial<StateData['pendingOperations']>): void {
        this.state.pendingOperations = {
            ...this.state.pendingOperations,
            ...update
        };
        this.stateChangeEmitter.fire(this.state);
    }
    
    async updateCherryPickState(status: {
        inProgress: boolean;
        branch?: string;
        commit?: string;
        hasConflicts?: boolean;
    }): Promise<void> {
        this.updateOperationState({
            cherryPick: {
                inProgress: status.inProgress,
                branch: status.branch || '',
                commit: status.commit || '',
                hasConflicts: status.hasConflicts || false
            }
        });
    }

    async reset(): Promise<void> {
        this.state = {
            savedVersions: {},
            savedRepos: [],
            lastUpdated: Date.now(),
            pendingOperations: {}
        };
        await this.saveState();
    }

    getState(): Readonly<StateData> {
        return { ...this.state };
    }
}