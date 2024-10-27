import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "backporter-x-5000" is now active!');

    const disposable = vscode.commands.registerCommand('backporter-x-5000.openWebview', () => {
        const panel = vscode.window.createWebviewPanel(
            'backporterX5000', 
            'Backporter X-5000', 
            vscode.ViewColumn.One, 
            {
                enableScripts: true,
            }
        );

        panel.webview.html = getWebviewContent(context, panel.webview);

        panel.webview.onDidReceiveMessage(async (message) => {
            let repoName = message.repoName;
            const newRepoName = message.newRepoName.trim();

            if (newRepoName) {
                repoName = newRepoName;
                const savedRepos = context.globalState.get<string[]>('savedRepos', []);
                if (!savedRepos.includes(newRepoName)) {
                    savedRepos.push(newRepoName);
                    await context.globalState.update('savedRepos', savedRepos);
                }
            }

            const versions = message.versions.split(',').map((v: string) => v.trim());
            const cherryPickBranch = message.cherryPickBranch;

            for (const version of versions) {
                const branchName = `cherry-pick-branch_${version}`;
                const createBranch = await promptUser(`Create branch ${branchName}? Y / N`);
                if (createBranch.toLowerCase() === 'y') {
                    await createBranchAndCherryPick(repoName, version, cherryPickBranch, branchName);
                }
            }
        });
    });

    context.subscriptions.push(disposable);
}

async function createBranchAndCherryPick(repoName: string, version: string, cherryPickBranch: string, newBranch: string) {
    try {
        await execCommand(`git checkout ${version}`);
        await execCommand(`git checkout -b ${newBranch}`);
        await execCommand(`git cherry-pick ${cherryPickBranch}`);
        await execCommand(`git push origin ${newBranch}`);
        vscode.window.showInformationMessage(`Branch ${newBranch} created and pushed successfully.`);

        const prUrl = await promptUser('Please provide the URL of the original PR:');
        if (prUrl) {
            await createPullRequest(repoName, prUrl, newBranch, version.split(',').map(v => v.trim()));
        }
    } catch (error: any) {
        if (error.message.includes('conflict')) {
            vscode.window.showWarningMessage(`Conflict detected while cherry-picking into ${newBranch}. Please resolve the conflicts and then continue.`);

            const resolveConflicts = await promptUser(`Have you resolved the conflicts in ${newBranch}? Y / N`);
            if (resolveConflicts.toLowerCase() === 'y') {
                try {
                    await execCommand(`git cherry-pick --continue`);
                    await execCommand(`git push origin ${newBranch}`);
                    vscode.window.showInformationMessage(`Branch ${newBranch} created and pushed successfully.`);

                    const prUrl = await promptUser('Please provide the URL of the original PR:');
                    if (prUrl) {
                        await createPullRequest(repoName, prUrl, newBranch, version.split(',').map(v => v.trim()));
                    }
                } catch (continueError: any) {
                    vscode.window.showErrorMessage(`Error continuing cherry-pick in ${newBranch}: ${continueError.message}`);
                }
            } else {
                vscode.window.showInformationMessage(`Please resolve the conflicts in ${newBranch} and run 'git cherry-pick --continue' manually.`);
            }
        } else {
            vscode.window.showErrorMessage(`Error creating branch ${newBranch}: ${error.message}`);
        }
    }
}

async function createPullRequest(repoName: string, prUrl: string, newBranch: string, versions: string[]) {
    try {
        const prData = await fetchPullRequestData(prUrl);
        const newPrTitle = `${prData.title} (${versions.join(', ')})`;

        const versionPrUrls: { [version: string]: string } = {};
        for (const version of versions) {
            const versionPrUrl = await fetchVersionPrUrl(repoName, version);
            versionPrUrls[version] = versionPrUrl;
        }

        const newPrBody = modifyPrBody(prData.body, prUrl, versionPrUrls);

        await createGitHubPullRequest(repoName, newBranch, newPrTitle, newPrBody);
        vscode.window.showInformationMessage(`Pull request created successfully for branch ${newBranch}.`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error creating pull request: ${error.message}`);
    }
}

async function fetchVersionPrUrl(repoName: string, version: string): Promise<string> {
    const command = `gh pr list --repo ${repoName} --state closed --head ${version} --json url --jq '.[0].url'`;
    try {
        const url = await execCommand(command);
        if (url) {
            return url.trim();
        } else {
            throw new Error(`No PR found for version ${version}`);
        }
    } catch (error: any) {
        throw new Error(`Error fetching PR URL for version ${version}: ${error.message}`);
    }
}

async function fetchPullRequestData(prUrl: string): Promise<{ title: string, body: string }> {
    const prApiUrl = prUrl.replace('github.com', 'api.github.com/repos').replace('/pull/', '/pulls/');
    const response = await axios.get(prApiUrl);
    return {
        title: response.data.title,
        body: response.data.body
    };
}

function modifyPrBody(body: string, originalPrUrl: string, versionPrUrls: { [version: string]: string }): string {
    const crossCoverageSection = `
## 水平展開 | Cross-coverage
<!-- 不具合修正の場合、報告された機能以外に同様の不具合がないか調査を行い、対応すべき機能を洗い出して記載する -->
<!-- If fixing a bug, search for similar features and describe if they need to be fixed as well -->

${originalPrUrl}
`;

    const versionsSection = Object.entries(versionPrUrls)
        .map(([version, url]) => `[release/${version.trim()}](${url})`)
        .join('\n');

    return body.replace(/(## 水平展開 \| Cross-coverage[\s\S]*?<!-- If fixing a bug, search for similar features and describe if they need to be fixed as well -->)/, `$1\n\n${versionsSection}`);
}

async function createGitHubPullRequest(repoName: string, branch: string, title: string, body: string) {
    const command = `gh pr create --repo ${repoName} --head ${branch} --title "${title}" --body "${body}" --base main`;
    await execCommand(command);
}

function execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function promptUser(message: string): Promise<string> {
    const input = await vscode.window.showInputBox({ prompt: message });
    return input || '';
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(
        path.join(context.extensionPath, 'build', 'webviewScript.js')
    ));

    const savedRepos = context.globalState.get<string[]>('savedRepos', []);
    const savedReposOptions = savedRepos.map(repo => `<option value="${repo}">${repo}</option>`).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Backporter X-5000</title>
            <style>
                .form-group {
                    margin-bottom: 10px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                }
                input, select {
                    width: 50%; /* Set the width to 50% */
                    padding: 8px;
                    box-sizing: border-box;
                }
            </style>
        </head>
        <body>
            <h1>Backporter X-5000</h1>
            <form id="backportForm">
                <div class="form-group">
                    <label for="repoName">Select Repository Name:</label>
                    <select id="repoName" name="repoName">
                        ${savedReposOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label for="newRepoName">Or Add New Repository Name:</label>
                    <input type="text" id="newRepoName" name="newRepoName">
                </div>
                <div class="form-group">
                    <label for="versions">Versions to Backport (comma-separated):</label>
                    <input type="text" id="versions" name="versions" required>
                </div>
                <div class="form-group">
                    <label for="cherryPickBranch">Cherry-pick Branch Name:</label>
                    <input type="text" id="cherryPickBranch" name="cherryPickBranch" required>
                </div>
                <button type="submit">Start Backport</button>
            </form>
            <script src="${scriptUri}"></script>
        </body>
        </html>
    `;
}

export function deactivate() {}