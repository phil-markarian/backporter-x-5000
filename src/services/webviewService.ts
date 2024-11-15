import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getMainStyles, getPrSelectionStyles } from '../ui/styles';
import { PRInfo } from '../types';

export class WebviewService {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async getWebviewContentWithCSP(webview: vscode.Webview): Promise<string> {
        this.validateResources();

        const scriptUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'build', 'webview.js')
        ));
        const imageUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'media', 'side-image.jpg')
        ));
        
        const savedRepos = this.context.globalState.get<string[]>('savedRepos', []);
        const savedReposOptions = savedRepos
            .map(repo => `<option value="${repo}">${repo}</option>`)
            .join('');

        const styles = getMainStyles(imageUri.toString());
        return this.getMainHtmlContent(
            webview.cspSource,
            scriptUri,
            savedReposOptions,
            styles
        );
    }

    async getPrSelectionHtml(webview: vscode.Webview, prInfo: PRInfo): Promise<string> {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'build', 'prSelectionScript.js')
        ));
        
        const styles = getPrSelectionStyles();
        return this.getPrSelectionHtmlContent(webview.cspSource, scriptUri, prInfo, styles);
    }

    private validateResources(): void {
        const scriptPath = path.join(this.context.extensionPath, 'build', 'webview.js');
        const imagePath = path.join(this.context.extensionPath, 'media', 'side-image.jpg');
        
        if (!fs.existsSync(scriptPath)) {
            throw new Error('webview.js not found');
        }
        if (!fs.existsSync(imagePath)) {
            throw new Error('Side image not found');
        }
    }

    private getCspTag(cspSource: string): string {
        return `
            <meta http-equiv="Content-Security-Policy"
                content="default-src 'none';
                         img-src ${cspSource} blob: data:;
                         script-src ${cspSource};
                         style-src ${cspSource} 'unsafe-inline';
                         connect-src ${cspSource};">
        `;
    }

    private getMainHtmlContent(
        cspSource: string,
        scriptUri: vscode.Uri,
        savedReposOptions: string,
        styles: string
    ): string {
        const savedVersionsContainer = `
            <div class="form-group">
                <label>Saved versions:</label>
                <div id="savedVersions"></div>
            </div>
        `;

        const repositorySelect = `
            <select id="repoName" name="repoName">
                <option value="">-- Select a repository --</option>
                ${savedReposOptions}
            </select>
        `;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                ${this.getCspTag(cspSource)}
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Backporter X-5000</title>
                <style>${styles}</style>
            </head>
            <body>
                <div class="container">
                    <div class="left-side">
                        <h1>Backporter X-5000</h1>
                        <form id="backportForm">
                            <div class="form-group">
                                <label for="repoName">Select Repository Name:</label>
                                ${repositorySelect}
                            </div>
                            <div class="form-group">
                                <label for="newRepoName">Or Add New Repository Name:</label>
                                <input type="text" id="newRepoName" name="newRepoName">
                            </div>
                            <div class="form-group">
                                <label for="versions">Versions to Backport (comma-separated):</label>
                                <input type="text" id="versions" name="versions" required>
                            </div>
                            ${savedVersionsContainer}
                            <div class="form-group">
                                <label for="cherryPickCommit">Cherry-pick commit:</label>
                                <input type="text" id="cherryPickCommit" name="cherryPickCommit" required>
                            </div>
                            <button type="button" id="submitButton">Start Backport</button>
                        </form>
                    </div>
                    <div class="right-side"></div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private getPrSelectionHtmlContent(
        cspSource: string,
        scriptUri: vscode.Uri,
        prInfo: PRInfo,
        styles: string
    ): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                ${this.getCspTag(cspSource)}
                <style>${styles}</style>
            </head>
            <body>
                <div class="container">
                    <div class="pr-info">
                        <h3>Found PR from commit:</h3>
                        <p>${prInfo?.title || "No PR found"}</p>
                        <button id="usePRButton">Use this PR</button>
                        <button id="searchButton">Search for different PR</button>
                    </div>
                    
                    <div class="search-box" style="display: none;">
                        <input type="text" id="prSearch" placeholder="Search PRs...">
                        <div id="searchResults"></div>
                    </div>

                    <div class="pr-edit">
                        <h3>Edit PR Details:</h3>
                        <input type="text" id="prTitle" value="${prInfo?.title || ""}" placeholder="PR Title">
                        <textarea id="prBody" rows="10" placeholder="PR Description">${prInfo?.body || ""}</textarea>
                        <button id="saveButton">Save Changes</button>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}