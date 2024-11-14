import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import axios from 'axios';

let workspacePath: string | undefined;

type SavedVersions = { [repoName: string]: string[] };
let savedVersions: SavedVersions = {};

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "backporter-x-5000" is now active!');
    savedVersions = context.globalState.get<SavedVersions>('savedVersions', {});

    const disposable = vscode.commands.registerCommand('backporter-x-5000.openWebview', () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        workspacePath = workspaceFolders[0].uri.fsPath;

        console.log('Opening webview...');
        const panel = vscode.window.createWebviewPanel(
            'backporterX5000', 
            'Backporter X-5000', 
            vscode.ViewColumn.One, 
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'build')),
                    vscode.Uri.file(path.join(context.extensionPath, 'media'))
                ],
                retainContextWhenHidden: true,
            }
        );

        panel.webview.html = getWebviewContentWithCSP(context, panel.webview);
        console.log('Webview content set.');

        panel.webview.onDidReceiveMessage(async (message) => {
            console.log('Message received from webview:', message);
    
            switch (message.type) {
                case 'error':
                    vscode.window.showErrorMessage(message.payload);
                    return;
    
                case 'test':
                    console.log('Test message received:', message.payload);
                    return;
    
                case 'loadSavedVersions':
                    const versions = savedVersions[message.repoName] || [];
                    panel.webview.postMessage({ 
                        type: 'savedVersions',
                        versions 
                    });
                    break;
    
                case 'deleteVersion':
                    if (savedVersions[message.repoName]) {
                        savedVersions[message.repoName] = savedVersions[message.repoName]
                            .filter(v => v !== message.version);
                        await context.globalState.update('savedVersions', savedVersions);
                        panel.webview.postMessage({ 
                            type: 'savedVersions',
                            versions: savedVersions[message.repoName] 
                        });
                    }
                    break;
    
                case 'formSubmit':
                    if (!await validateGitRepo()) {
                        return;
                    }
    
                    let repoName = message.payload.repoName;
                    const newRepoName = message.payload.newRepoName.trim();
    
                    if (newRepoName) {
                        repoName = newRepoName;
                        const savedRepos = context.globalState.get<string[]>('savedRepos', []);
                        if (!savedRepos.includes(newRepoName)) {
                            savedRepos.push(newRepoName);
                            await context.globalState.update('savedRepos', savedRepos);
                            console.log('New repository name saved:', newRepoName);
                        }
                    }
    
                    // Save versions for the repository
                    const inputVersions = message.payload.versions.split(',')
                        .map((v: string) => v.trim())
                        .filter((v: string) => v);
    
                    if (repoName) {
                        const existingVersions = savedVersions[repoName] || [];
                        savedVersions[repoName] = Array.from(new Set([...existingVersions, ...inputVersions]));
                        await context.globalState.update('savedVersions', savedVersions);
                    }
    
                    const cherryPickCommit = message.payload.cherryPickCommit;

                    for (const version of inputVersions) {
                        const cherryPickBranchName = await getBranchNameFromCommit(cherryPickCommit);
                        const branchName = `${cherryPickBranchName}__${version}`;
                        const createBranch = await promptUser(`Create branch ${branchName}? Y / N`);
                        if (createBranch.toLowerCase() === 'y') {
                            console.log(`Creating branch ${branchName}...`);
                            await createBranchAndCherryPick(repoName, version, cherryPickCommit, branchName);
                        }
                    }
                    break;
            }
        });
    });

    context.subscriptions.push(disposable);
}

async function getBranchNameFromCommit(commitHash: string): Promise<string> {
    try {
        // First try to get the commit message to check if it's a merge PR
        const commitMsgCommand = `git log -1 --pretty=format:%s ${commitHash}`;
        const commitMsg = await execCommand(commitMsgCommand);
        
        // Check if it's a merge PR commit
        const mergePRMatch = commitMsg.match(/Merge pull request #\d+ from [\w-]+\/([\w\/-]+)/);
        if (mergePRMatch) {
            // Return the branch name part
            return mergePRMatch[1];
        }

        // Fallback to using name-rev if not a merge PR
        const command = `git name-rev --name-only ${commitHash}`;
        const branchName = await execCommand(command);
        
        return branchName.trim()
            .replace('remotes/origin/', '')
            .replace('tags/', '')
            .split('~')[0]
            .split('^')[0];
    } catch (error) {
        console.error('Error getting branch name:', error);
        return 'cherry-pick';
    }
}

// Add helper function to fetch GitHub users
async function fetchGitHubUsers(repoName: string): Promise<string[]> {
    try {
        const fullRepoName = await getFullRepoName(repoName);
        
        // Get org members
        const orgName = fullRepoName.split('/')[0];
        const orgMembers = await execCommand(`gh api orgs/${orgName}/members --jq '.[].login'`);
        
        // Get repo collaborators
        const collaborators = await execCommand(`gh api repos/${fullRepoName}/collaborators --jq '.[].login'`);
        
        // Combine and deduplicate users
        const allUsers = new Set([
            ...orgMembers.split('\n'),
            ...collaborators.split('\n')
        ].filter(user => user.trim()));

        return Array.from(allUsers);
    } catch (error) {
        console.error('Error fetching GitHub users:', error);
        return [];
    }
}

// Update handlePRAssignment function
async function handlePRAssignment(repoName: string): Promise<string> {
    const selfAssign = await vscode.window.showQuickPick(
        [
            { label: 'Yes', description: 'Assign PR to myself' },
            { label: 'No', description: 'Assign PR to someone else' }
        ],
        {
            placeHolder: 'Self-assign? Y/N',
            ignoreFocusOut: true
        }
    );

    if (selfAssign?.label === 'Yes') {
        return '@self';
    }

    const users = await fetchGitHubUsers(repoName);
    const quickPickItems = users.map(user => ({
        label: `@${user}`,
        description: `Assign to ${user}`
    }));

    const assignee = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select assignee',
        matchOnDescription: true,
        ignoreFocusOut: true
    });

    return assignee?.label || '';
}

// Update selectReviewer function
async function selectReviewer(repoName: string): Promise<string> {
    const users = await fetchGitHubUsers(repoName);
    const quickPickItems = [
        ...users.map(user => ({
            label: `@${user}`,
            description: `Request review from ${user}`
        }))
    ];

    const reviewer = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Choose reviewer',
        matchOnDescription: true,
        ignoreFocusOut: true
    });

    return reviewer?.label || '';
}


// Update validateGitRepo with more logging:
async function validateGitRepo(): Promise<boolean> {
    try {
        console.log('Validating git repository...');
        console.log('Current workspace:', workspacePath);
        
        const gitStatus = await execCommand('git status');
        console.log('Git status:', gitStatus);
        
        return true;
    } catch (error) {
        console.error('Git validation error:', error);
        vscode.window.showErrorMessage(`Git validation failed: ${error}`);
        return false;
    }
}

async function branchExists(branchName: string): Promise<boolean> {
    try {
        // Check local branches
        await execCommand(`git rev-parse --verify ${branchName}`);
        return true;
    } catch {
        try {
            // Check remote branches
            await execCommand(`git rev-parse --verify origin/${branchName}`);
            return true;
        } catch {
            return false;
        }
    }
}

async function createBranchAndCherryPick(repoName: string, version: string, cherryPickCommit: string, newBranch: string) {
    try {
        // Check if the version branch exists
        const versionExists = await branchExists(version);
        if (!versionExists) {
            vscode.window.showWarningMessage(`Version '${version}' does not exist. Skipping...`);
            return; // Skip this version
        }

        // Check if the new branch already exists
        const exists = await branchExists(newBranch);
        if (exists) {
            const useExisting = await vscode.window.showQuickPick(
                [
                    { label: 'Yes', description: 'Use existing branch' },
                    { label: 'No', description: 'Create new branch with different name' }
                ],
                {
                    placeHolder: `Branch ${newBranch} already exists. Use existing branch?`,
                    ignoreFocusOut: true
                }
            );

            if (useExisting?.label === 'Yes') {
                console.log(`Using existing branch ${newBranch}`);
                await execCommand(`git checkout ${newBranch}`);
            } else {
                const suffix = new Date().getTime();
                newBranch = `${newBranch}-${suffix}`;
                console.log(`Creating new branch ${newBranch}...`);
                await execCommand(`git checkout ${version}`);
                await execCommand(`git checkout -b ${newBranch}`);
            }
        } else {
            console.log(`Checking out version ${version}...`);
            await execCommand(`git checkout ${version}`);
            console.log(`Creating new branch ${newBranch}...`);
            await execCommand(`git checkout -b ${newBranch}`);
        }

        console.log(`Cherry-picking commit ${cherryPickCommit}...`);
        const isMergeCommit = await checkIfMergeCommit(cherryPickCommit);
        let cherryPickCommand = `git cherry-pick ${cherryPickCommit}`;
        if (isMergeCommit) {
            cherryPickCommand = `git cherry-pick -m 1 ${cherryPickCommit}`;
            console.log('Detected merge commit. Using -m 1 option for cherry-pick.');
        }

        try {
            await execCommand(cherryPickCommand);
            console.log('Cherry-pick successful');

            console.log(`Pushing branch ${newBranch} to origin...`);
            await execCommand(`git push origin ${newBranch}`);

            await getPRUrlWithRetry(repoName, newBranch, [version]);
        } catch (error: any) {
            if (error.message.includes('could not apply')) {
                console.log('Conflict detected:', error.message);

                const resolveConflicts = await vscode.window.showQuickPick(
                    [
                        { label: 'Yes', description: 'Resolve conflicts now' },
                        { label: 'No', description: 'Abort cherry-pick' }
                    ],
                    {
                        placeHolder: 'Would you like to resolve conflicts?',
                        ignoreFocusOut: true
                    }
                );

                if (resolveConflicts?.label === 'Yes') {
                    const conflictResolved = await handleConflictResolution(newBranch);

                    if (conflictResolved) {
                        console.log(`Pushing branch ${newBranch} to origin...`);
                        await execCommand(`git push origin ${newBranch}`);
                        await getPRUrlWithRetry(repoName, newBranch, [version]);
                    }
                } else {
                    await execCommand('git cherry-pick --abort');
                    throw new Error('Cherry-pick aborted by user');
                }
            } else {
                throw error;
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        console.error('Error:', error);
        // Clean up if needed
        try {
            await execCommand('git cherry-pick --abort');
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
        }
    }
}

async function waitForUserToResolveConflicts(): Promise<'continue' | 'editing' | 'cancel'> {
    try {
        // Get list of files with conflicts
        const conflictOutput = await execCommand('git diff --name-only --diff-filter=U');
        const conflictedFiles = conflictOutput.split('\n').filter(file => file.trim() !== '');

        if (conflictedFiles.length === 0) {
            throw new Error('No conflicted files found');
        }

        // Open each conflicted file in editor
        for (const file of conflictedFiles) {
            const uri = vscode.Uri.file(path.join(workspacePath!, file));
            await vscode.window.showTextDocument(uri, { preview: false });
        }

        // Show SCM view
        await vscode.commands.executeCommand('workbench.view.scm');

        // Create file watcher for conflicted files
        const fileWatchers = conflictedFiles.map(file => {
            const uri = vscode.Uri.file(path.join(workspacePath!, file));
            return vscode.workspace.createFileSystemWatcher(uri.fsPath);
        });

        return new Promise((resolve) => {
            const disposables: vscode.Disposable[] = [];

            // Listen for file saves
            fileWatchers.forEach(watcher => {
                disposables.push(
                    watcher.onDidChange(async () => {
                        // Show resolution dialog on every save
                        const choice = await vscode.window.showInformationMessage(
                            'Have you resolved all conflicts?',
                            { modal: true },
                            'Yes',
                            'Continue Editing',
                            'Cancel'
                        );

                        switch (choice) {
                            case 'Yes':
                                // Clean up before resolving
                                disposables.forEach(d => d.dispose());
                                fileWatchers.forEach(w => w.dispose());
                                resolve('continue');
                                break;
                            case 'Continue Editing':
                                // Do nothing, let them keep editing
                                break;
                            case 'Cancel':
                            default:
                                // Clean up before resolving
                                disposables.forEach(d => d.dispose());
                                fileWatchers.forEach(w => w.dispose());
                                resolve('cancel');
                        }
                    })
                );
            });

            // Add cleanup for cancellation
            disposables.push(
                vscode.workspace.onDidCloseTextDocument((doc) => {
                    if (conflictedFiles.some(file => doc.uri.fsPath.endsWith(file))) {
                        // Clean up before resolving
                        disposables.forEach(d => d.dispose());
                        fileWatchers.forEach(w => w.dispose());
                        resolve('cancel');
                    }
                })
            );
        });

    } catch (error: any) {
        console.error('Error handling conflicts:', error);
        vscode.window.showErrorMessage(`Error handling conflicts: ${error.message}`);
        return 'cancel';
    }
}

// Update createBranchAndCherryPick to use new conflict resolution flow
async function handleConflictResolution(newBranch: string): Promise<boolean> {
    let resolving = true;
    while (resolving) {
        const result = await waitForUserToResolveConflicts();
        
        switch (result) {
            case 'continue':
                await execCommand('git add .');
                await execCommand('git cherry-pick --continue');
                resolving = false;
                return true;
            
            case 'editing':
                // User wants to continue editing, loop continues
                continue;
            
            case 'cancel':
                await execCommand('git cherry-pick --abort');
                throw new Error('Cherry-pick cancelled by user');
        }
    }
    return false;
}

async function checkIfMergeCommit(commitHash: string): Promise<boolean> {
    try {
        const parents = await execCommand(`git rev-list --parents -n 1 ${commitHash}`);
        const parentHashes = parents.trim().split(' ');
        const parentCount = parentHashes.length - 1; // First entry is the commit itself
        return parentCount > 1;
    } catch (error) {
        console.error('Error checking if commit is a merge commit:', error);
        return false;
    }
}

async function createPullRequest(repoName: string, prUrl: string, newBranch: string, versions: string[]) {
    // Create progress handler
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Creating Pull Request",
        cancellable: true
    }, async (progress, token) => {
        try {
            // Step 1: Fetch PR data
            progress.report({ 
                message: "Fetching original PR data...",
                increment: 20 
            });
            const prData = await fetchPullRequestData(prUrl);

            // Step 2: Generate new title
            progress.report({ 
                message: "Generating PR title...",
                increment: 20 
            });
            const newPrTitle = `${prData.title} (${versions.join(', ')})`;

            // Step 3: Get version PR URLs
            progress.report({ 
                message: "Fetching version PR URLs...",
                increment: 20 
            });
            const versionPrUrls: { [version: string]: string } = {};
            for (const version of versions) {
                const versionPrUrl = await fetchVersionPrUrl(repoName, version);
                versionPrUrls[version] = versionPrUrl;
            }

            // Step 4: Modify PR body
            progress.report({ 
                message: "Preparing PR description...",
                increment: 20 
            });
            const prBody = prData.body;

            // Step 5: Create PR
            progress.report({ 
                message: "Creating GitHub pull request...",
                increment: 20 
            });
            await createGitHubPullRequest(repoName, newBranch, newPrTitle, prBody);

            // Success message
            vscode.window.showInformationMessage(`Pull request created successfully for branch ${newBranch}.`);

        } catch (error: any) {
            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Pull request creation cancelled');
                return;
            }
            
            if (error.message.includes('Pull request not found')) {
                throw error; // Propagate PR not found error
            }
            throw new Error(`Error creating pull request: ${error.message}`);
        }
    });
}

async function fetchVersionPrUrl(repoName: string, version: string): Promise<string> {
    try {
        const fullRepoName = await getFullRepoName(repoName);
        const command = `gh pr list --repo ${fullRepoName} --state closed --head ${version} --json url --jq '.[0].url'`;
        console.log('Executing command:', command);
        
        const url = await execCommand(command);
        if (url) {
            return url.trim();
        }
        throw new Error(`No PR found for version ${version} in repository ${fullRepoName}`);
    } catch (error: any) {
        throw new Error(`Error fetching PR URL for version ${version}: ${error.message}`);
    }
}

async function getFullRepoName(repoName: string): Promise<string> {
    // If already in owner/repo format, return as is
    if (repoName.includes('/')) {
        return repoName;
    }

    try {
        // First try to get organization name
        const orgsCommand = `gh api /user/memberships/orgs --jq '.[].organization.login'`;
        const orgs = (await execCommand(orgsCommand)).trim().split('\n');
        
        // Check if repo exists in any org
        for (const org of orgs) {
            try {
                await execCommand(`gh repo view ${org}/${repoName}`);
                return `${org}/${repoName}`;
            } catch {
                continue;
            }
        }

        // If not found in orgs, try personal account
        const userName = (await execCommand('gh api user --jq .login')).trim();
        return `${userName}/${repoName}`;
    } catch (error) {
        console.error('Error resolving full repo name:', error);
        throw new Error(`Could not determine full repository name for ${repoName}. Please use 'owner/repo' format.`);
    }
}

async function getPRUrlWithRetry(repoName: string, newBranch: string, version: string[]): Promise<void> {
    let retrying = true;
    
    while (retrying) {
        try {
            const prUrl = await vscode.window.showInputBox({
                prompt: 'Please provide the URL of the original PR:',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value) {return 'PR URL is required';}
                    if (!value.includes('github.com') || !value.includes('/pull/')) {
                        return 'Invalid GitHub PR URL format';
                    }
                    return null;
                }
            });

            if (!prUrl) {
                const retry = await vscode.window.showWarningMessage(
                    'No PR URL provided. Would you like to try again?',
                    'Yes',
                    'No'
                );
                if (retry !== 'Yes') {
                    retrying = false;
                    break;
                }
                continue;
            }

            await createPullRequest(repoName, prUrl, newBranch, version);
            retrying = false;
            
        } catch (error: any) {
            const retry = await vscode.window.showErrorMessage(
                `${error.message}. Would you like to try again?`,
                'Yes',
                'No'
            );
            
            if (retry !== 'Yes') {
                retrying = false;
                break;
            }
            // Continue loop to retry
        }
    }
}

async function fetchPullRequestData(prUrl: string): Promise<{ title: string, body: string }> {
    try {
        // Extract repo info from PR URL
        const urlParts = prUrl.split('/');
        const prNumber = urlParts[urlParts.length - 1];
        const repoOwner = urlParts[urlParts.length - 4];
        const repoName = urlParts[urlParts.length - 3];
        const fullRepo = `${repoOwner}/${repoName}`;

        // Verify access
        await execCommand(`gh repo view ${fullRepo}`);

        const command = `gh pr view ${prNumber} --repo ${fullRepo} --json title,body`;
        const prDataRaw = await execCommand(command);
        const prData = JSON.parse(prDataRaw);

        if (!prData.title || !prData.body) {
            throw new Error('Invalid PR data received');
        }

        return {
            title: prData.title,
            body: prData.body
        };
    } catch (error: any) {
        console.error('Error fetching PR data:', error);
        if (error.message.includes('could not resolve to a Repository')) {
            throw new Error('Repository not found or no access. Please check permissions.');
        }
        throw new Error(`Failed to fetch PR data: ${error.message}`);
    }
}

function modifyPrBody(body: string, originalPrUrl: string, versionPrUrls: { [version: string]: string }): string {
    const crossCoverageSection = `
## 水平展開 | Cross-coverage
<!-- 不具合修正の場合、報告された機能以外に同様の不具合がないか調査を行い、対応すべき機能を洗い出して記載する -->
<!-- If fixing a bug, search for similar features and describe if they need to be fixed as well -->

${originalPrUrl}
`;

    const versionsSection = Object.entries(versionPrUrls)
        .map(([version, url]) => `[${version.trim()}](${url})`)
        .join('\n');

    return body.replace(/(## 水平展開 \| Cross-coverage[\s\S]*?<!-- If fixing a bug, search for similar features and describe if they need to be fixed as well -->)/, `$1\n\n${versionsSection}`);
}

async function createGitHubPullRequest(repoName: string, branch: string, title: string, body: string) {
    try {
        const fullRepoName = await getFullRepoName(repoName);
        
        // Create PR and extract PR number from URL
        const createPRCommand = `gh pr create --repo ${fullRepoName} --head ${branch} --title "${title}" --body "${body}" --base main`;
        const prUrl = await execCommand(createPRCommand);
        const prNumber = prUrl.trim().split('/').pop() || '';

        // Handle assignment with auto-complete
        const assignee = await handlePRAssignment(repoName);
        if (assignee) {
            const assignCommand = assignee === '@self' 
                ? `gh pr edit ${prNumber} --add-assignee "@me"` 
                : `gh pr edit ${prNumber} --add-assignee "${assignee.substring(1)}"`;
            await execCommand(assignCommand);
        }

        // Handle reviewer with auto-complete
        const reviewer = await selectReviewer(repoName);
        if (reviewer) {
            const reviewCommand = `gh pr edit ${prNumber} --add-reviewer "${reviewer.substring(1)}"`;
            await execCommand(reviewCommand);
        }

        vscode.window.showInformationMessage(`Pull request #${prNumber} created and assigned successfully.`);
    } catch (error: any) {
        throw new Error(`Failed to create pull request: ${error.message}`);
    }
}

function execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!workspacePath) {
            reject(new Error('No workspace folder open'));
            return;
        }

        // Add debug logging
        console.log('Command:', command);
        console.log('Working directory:', workspacePath);
        console.log('Git repo check:', require('child_process').execSync('pwd', { cwd: workspacePath }).toString());

        exec(command, { 
            cwd: workspacePath,
            // Add environment variables
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout, stderr) => {
            if (error) {
                console.log('Command error:', error.message);
                console.log('Command stderr:', stderr);
                reject(error);
            } else {
                console.log('Command stdout:', stdout);
                resolve(stdout);
            }
        });
    });
}

async function promptUser(message: string): Promise<string> {
    console.log('Prompting user:', message);
    
    // For merge conflict resolution, use QuickPick instead of InputBox
    if (message.includes('Conflicts occurred')) {
        const options: vscode.QuickPickItem[] = [
            { label: 'Yes', description: 'Resolve conflicts now' },
            { label: 'No', description: 'Abort cherry-pick' }
        ];

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: message,
            ignoreFocusOut: true,
            canPickMany: false
        });

        return selection?.label || 'No';
    }

    // For other prompts, use InputBox
    const input = await vscode.window.showInputBox({ 
        prompt: message,
        ignoreFocusOut: true 
    });
    
    return input || '';
}

function getWebviewContentWithCSP(context: vscode.ExtensionContext, webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(
        path.join(context.extensionPath, 'build', 'webviewScript.js')
    ));

    console.log('Script URI:', scriptUri.toString());

    const imagePath = path.join(context.extensionPath, 'media', 'side-image.jpg');
    console.log('Full image path:', imagePath);
    console.log('Image exists:', require('fs').existsSync(imagePath));

    const imageUri = webview.asWebviewUri(vscode.Uri.file(imagePath));
    console.log('Image URI:', imageUri.toString());
    const savedRepos = context.globalState.get<string[]>('savedRepos', []);
    const savedReposOptions = savedRepos.map(repo => `<option value="${repo}">${repo}</option>`).join('');

    const cspSource = webview.cspSource;

    const savedVersionsContainer = `
        <div class="form-group">
            <label>Saved versions:</label>
            <div id="savedVersions"></div>
        </div>
    `;

    const repositorySelect = `
        <select id="repoName" name="repoName" onchange="loadSavedVersions()">
            <option value="">-- Select a repository --</option>
            ${savedReposOptions}
        </select>
    `;

    const csp = `
        <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     img-src ${cspSource} blob: data:;
                     script-src ${cspSource};
                     style-src ${cspSource} 'unsafe-inline';
                     connect-src ${cspSource};">
    `;

    const styles = `
        body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
        .container {
            display: flex;
            width: 100%;
            min-height: 100vh;
        }
        .left-side {
        width: 30%;
        background-color: #2B86CD; /* VS Code blue */
        padding: 40px;
        box-sizing: border-box;
        color: white; /* For better contrast on blue */
    }
        .right-side {
        width: 70%;
        background-image: url('${imageUri}');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
    }
        .form-group {
        margin-bottom: 20px;
    }
        label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: rgba(255,255,255,0.9);
    }
        input, select {
        width: 90%;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.1);
        color: white;
        font-size: 14px;
    }
        input::placeholder {
        color: rgba(255,255,255,0.5);
    }
        input:disabled {
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.3);
        cursor: not-allowed;
    }
        select option {
        background: #007acc;
        color: white;
    }
        h1 {
        margin-bottom: 30px;
        font-size: 24px;
        font-weight: 400;
        color: white;
    }
        /* Style for the submit button */
        #submitButton {
        width: 90%;
        padding: 12px 24px;
        background: #CD722B;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        margin-top: 20px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        text-align: center;
        display: block;
    }
    #submitButton:hover {
        background: #35CD2B;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        transform: translateY(-1px);
    }
        #submitButton:active {
            transform: translateY(1px);
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        #submitButton:disabled {
            background: #cccccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        /* Styles for version buttons */
        .version-item {
            display: inline-block;
            margin: 0 10px 10px 0;
            position: relative;
        }
         .version-add {
        padding: 8px 16px;
        background: #CD722B;
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .version-add:hover {
        background: #35CD2B; /* Darker shade for hover */
    }
        .version-delete {
            position: absolute;
            top: -8px;
            right: -8px;
            width: 20px;
            height: 20px;
            background: #cc0000;
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            opacity: 0;
        }
        .version-item:hover .version-delete {
            opacity: 1;
        }
        .version-delete:hover {
            background: #aa0000;
        }
            label.disabled {
        opacity: 0.5;
    }
    `;



    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            ${csp}
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Backporter X-5000</title>
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
                        <!-- Add saved versions container -->
                        ${savedVersionsContainer}
                        <div class="form-group">
                            <label for="cherryPickCommit">Cherry-pick commit:</label>
                            <input type="text" id="cherryPickCommit" name="cherryPickCommit" required>
                        </div>
                        <button type="button" id="submitButton">Start Backport</button>
                    </form>
                </div>
                <div class="right-side" style="background-image: url('${imageUri}');">
            </div>
            </div>
            <script src="${scriptUri}"></script>
        </body>
        <style>
        ${styles}
        </style>
        </html>
    `;
}

export function deactivate() {}