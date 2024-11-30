import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getMainStyles, getPrSelectionStyles } from "../ui/styles";
import { PRInfo } from "../types";
import { LanguageService } from "./languageService";

export class WebviewService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly languageService: LanguageService,
  ) {}

  async getWebviewContentWithCSP(
    webview: vscode.Webview,
    language?: string,
    strings?: Record<string, string>,
  ): Promise<string> {
    this.validateResources();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          "build",
          "webview",
          "ui",
          "webview",
          "webview.js",
        ),
      ),
    );
    const imageUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, "media", "side-image.jpg"),
      ),
    );

    const savedRepos = this.context.globalState.get<string[]>("savedRepos", []);
    const savedReposOptions = savedRepos
      .map((repo) => `<option value="${repo}">${repo}</option>`)
      .join("");

    const styles = getMainStyles(imageUri.toString());
    return this.getMainHtmlContent(
      webview.cspSource,
      scriptUri,
      savedReposOptions,
      styles,
      language || this.languageService.getCurrentLanguage(),
      strings ||
        this.languageService.getStringsForLanguage(
          language || this.languageService.getCurrentLanguage(),
        ),
    );
  }

  /* async getPrSelectionHtml(webview: vscode.Webview, prInfo: PRInfo): Promise<string> {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'build', 'prSelectionScript.js')
        ));
        
        const styles = getPrSelectionStyles();
        return this.getPrSelectionHtmlContent(webview.cspSource, scriptUri, prInfo, styles);
    } */

  private validateResources(): void {
    const scriptPath = path.join(
      this.context.extensionPath,
      "build",
      "webview",
      "ui",
      "webview",
      "webview.js",
    );
    const imagePath = path.join(
      this.context.extensionPath,
      "media",
      "side-image.jpg",
    );

    if (!fs.existsSync(scriptPath)) {
      throw new Error("webview.js not found");
    }
    if (!fs.existsSync(imagePath)) {
      throw new Error("Side image not found");
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

  private languageSelector(currentLanguage: string): string {
    const availableLanguages = this.languageService.getAvailableLanguages();
    const defaultLanguage = availableLanguages[0]; // First language in yaml becomes default

    const languages = availableLanguages.map((code) => ({
      code,
      name: this.languageService.getString(`language_${code}`, defaultLanguage),
    }));

    return `
            <div class="language-selector">
                <select id="languageSelector" class="language-select">
                    ${languages
                      .map(
                        (lang) => `
                        <option value="${lang.code}" ${currentLanguage === lang.code ? "selected" : ""}>
                            ${lang.name}
                        </option>
                    `,
                      )
                      .join("")}
                </select>
            </div>
        `;
  }

  private getSavedVersionsContainer(): string {
    const strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );
    return `
            <div class="form-group">
                <label for="savedVersions">${strings.saved_versions_label}</label>
                <div id="savedVersions" class="saved-versions-container"></div>
            </div>
        `;
  }

  private getRepositorySelect(savedReposOptions: string): string {
    const strings = this.languageService.getStringsForLanguage(
      this.languageService.getCurrentLanguage(),
    );
    return `
            <select id="repoName" name="repoName">
                <option value="">${strings.select_repository}</option>
                ${savedReposOptions}
            </select>
        `;
  }

  private getMainHtmlContent(
    cspSource: string,
    scriptUri: vscode.Uri,
    savedReposOptions: string,
    styles: string,
    currentLanguage: string,
    p0: Record<string, string>,
  ): string {
    const strings = this.languageService.getStringsForLanguage(currentLanguage);

    return `
            <!DOCTYPE html>
            <html lang="${currentLanguage}">
            <head>
                <meta charset="UTF-8">
                ${this.getCspTag(cspSource)}
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${strings.webview_title}</title>
                <style>${styles}</style>
            </head>
            <body>
                <div class="container">
                    <div class="left-side">
                        <div class="header-container">
                        <h1>${strings.webview_title}</h1>
                        ${this.languageSelector(currentLanguage)}
                        </div>
                        <form id="backportForm">
                            <div class="form-group">
                                <label for="repoName">${strings.repo_name_label}</label>
                                ${this.getRepositorySelect(savedReposOptions)}
                            </div>
                            <div class="form-group">
                                <label for="newRepoName">${strings.new_repo_label}</label>
                                <input type="text" id="newRepoName" name="newRepoName">
                            </div>
                            <div class="form-group">
                                <label for="versions">${strings.versions_label}</label>
                                <input type="text" id="versions" name="versions" required>
                            </div>
                            ${this.getSavedVersionsContainer()}
                            <div class="form-group">
                                <label for="cherryPickCommit">${strings.cherry_pick_label}</label>
                                <input type="text" id="cherryPickCommit" name="cherryPickCommit" required>
                            </div>
                            <div class="form-group">
                                <label for="prUrl">${strings.pr_url_field_label}</label>
                                <input 
                                    type="text" 
                                    id="prUrl" 
                                    name="prUrl" 
                                    placeholder="${strings.pr_url_field_placeholder}"
                                    required
                                >
                            </div>
                            <button type="button" id="submitButton" disabled>${strings.submit_button}</button>
                        </form>
                    </div>
                    <div class="right-side"></div>
                </div>
                <script src="${scriptUri}">
                window.initialStrings = ${JSON.stringify(strings)};
                window.currentLanguage = "${currentLanguage}";
                </script>
            </body>
            </html>
        `;
  }

  private getPrSelectionHtmlContent(
    cspSource: string,
    scriptUri: vscode.Uri,
    prInfo: PRInfo,
    styles: string,
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
