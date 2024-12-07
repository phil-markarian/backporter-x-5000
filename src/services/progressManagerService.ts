import * as vscode from 'vscode';
import { LanguageService } from './languageService';
import { StateService } from './stateService';

export class ProgressManagerService {
  private activeProgress?: vscode.Progress<{ message?: string; increment?: number }>;
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly languageService: LanguageService,
    private readonly stateService: StateService
  ) {
    // Subscribe to conflict state changes
    this.stateService.onConflictStateChanged(this.handleConflictStateChange.bind(this));
  }

  setPanel(panel: vscode.WebviewPanel | undefined) {
    this.panel = panel;
  }

  private isPanelActive(panel?: vscode.WebviewPanel): boolean {
    if (!panel) {return false;}
    try {
      return panel.active;
    } catch (e) {
      return false;
    }
  }

  async trackProgress<T>(options: {
    title: string,
    operation: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  }): Promise<T> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: this.languageService.getString(options.title),
      cancellable: false
    }, async (progress) => {
      this.activeProgress = progress;
      try {
        return await options.operation(progress);
      } finally {
        progress.report({ increment: 100 });
        this.activeProgress = undefined;
      }
    });
  }

  private async handleConflictStateChange({ hasConflicts, branch }: {
    hasConflicts: boolean;
    branch?: string;
  }): Promise<void> {
    if (!this.isPanelActive(this.panel)) {return;}

    const cherryPickState = this.stateService.getState().pendingOperations.cherryPick;
    
    if (hasConflicts && cherryPickState?.inProgress) {
      this.activeProgress?.report({
        message: this.languageService.getString("resolving_conflicts")
      });
    } else if (branch && cherryPickState?.success) {
      this.sendWebviewMessage("loading", false);
      this.showSuccess(this.languageService.getString("backport_success"));
      this.activeProgress = undefined;
    }
  }

  updateProgress(increment: number, message: string) {
    this.activeProgress?.report({
      increment,
      message
    });
  }

  sendWebviewMessage(type: string, payload: any) {
    if (this.isPanelActive(this.panel)) {
      this.panel!.webview.postMessage({ type, payload });
    }
  }

  showError(error: Error) {
    console.error(error);
    this.sendWebviewMessage('loading', false);
    this.sendWebviewMessage('error', error.message);
  }

  showSuccess(message: string) {
    this.sendWebviewMessage('loading', false);
    this.sendWebviewMessage('success', message);
  }
}