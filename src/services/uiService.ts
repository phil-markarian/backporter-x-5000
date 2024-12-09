import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from '../utils/git';
import { WorkspaceService } from './workspaceService';
import { LanguageService } from './languageService';
import { ConflictFile } from '../types';

export class UIService {
  private workspaceService: WorkspaceService;
  private strings: any;

  constructor(
    private readonly gitUtils: GitUtils,
    private readonly languageService: LanguageService
  ) {
    this.workspaceService = WorkspaceService.getInstance();
    this.strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage()
    );
  }

  async openConflictedFiles(files: string[]): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.scm");
    
    const originalEditor = vscode.window.activeTextEditor;
    
    for (const file of files) {
      await this.openFile(file);
    }
    
    if (originalEditor) {
      await vscode.window.showTextDocument(originalEditor.document);
    }
  }

  async openFile(file: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(
        path.join(this.workspaceService.workspacePath, file)
      );
      
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: false
      });
      
      await vscode.commands.executeCommand('workbench.action.keepEditor');
      
    } catch (error) {
      console.error(this.strings.error_unknown.replace("{0}", file), error);
    }
  }

    async showConflictDetectedDialog(files: string[]): Promise<boolean> {
    const fileList = files.map(f => `• ${f}`).join('\n');
    
    const choice = await vscode.window.showWarningMessage(
      `${this.strings.conflict_detected}\n\n${fileList}\n\n${this.strings.conflict_resolution_instructions}`,
      { modal: true },
      this.strings.open_files,
      this.strings.abort_cherry_pick
    );
  
    return choice === this.strings.open_files;
  }
  
async watchConflictedFiles(files: string[]): Promise<boolean> {
  const conflictFiles: ConflictFile[] = files.map(f => ({
    path: path.join(this.workspaceService.workspacePath, f),
    resolved: false
  }));

  // First show the modal conflict detection dialog
  const shouldContinue = await this.showConflictDetectedDialog(files);
  
  if (!shouldContinue) {
    return false;
  }

  // Open the files if user chose to continue
  await this.openConflictedFiles(files);

  // Show persistent resolution buttons in status bar
  return new Promise<boolean>((resolve) => {
    const completeButton = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1 // Higher priority to show first
    );
    const abortButton = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      0
    );

    // Set up complete button
    completeButton.text = `$(check) ${this.strings.complete_resolution}`;
    completeButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    completeButton.command = 'conflict-resolution.complete';
    completeButton.show();

    // Set up abort button
    abortButton.text = `$(x) ${this.strings.abort_cherry_pick}`;
    abortButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    abortButton.command = 'conflict-resolution.abort';
    abortButton.show();

    // Register commands
    const commandDisposables = [
      vscode.commands.registerCommand('conflict-resolution.complete', async () => {
        const allResolved = await Promise.all(
          conflictFiles.map(async f => await this.checkConflictResolution(f.path))
        );
        
        if (!allResolved.every(resolved => resolved)) {
          const choice = await vscode.window.showWarningMessage(
            this.strings.conflicts_not_resolved,
            this.strings.continue_editing,
            this.strings.abort_cherry_pick
          );
          
          if (choice === this.strings.continue_editing) {
            return;
          }
          completeButton.dispose();
          abortButton.dispose();
          commandDisposables.forEach(d => d.dispose());
          resolve(false);
        } else {
          completeButton.dispose();
          abortButton.dispose();
          commandDisposables.forEach(d => d.dispose());
          resolve(true);
        }
      }),

      vscode.commands.registerCommand('conflict-resolution.abort', () => {
        completeButton.dispose();
        abortButton.dispose();
        commandDisposables.forEach(d => d.dispose());
        resolve(false);
      })
    ];
  });
}

  private async checkConflictResolution(filePath: string): Promise<boolean> {
    try {
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(filePath)
      );
      const text = Buffer.from(content).toString('utf8');
      return !text.includes('<<<<<<<') && !text.includes('>>>>>>>');
    } catch (error) {
      return false;
    }
  }
}