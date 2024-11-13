// webviewScript.ts
declare function acquireVsCodeApi(): any;

// Rename to avoid conflict with built-in FormData
interface BackportFormData {
    newRepoName: string;
    repoName: string;
    versions: string;
    cherryPickCommit: string;
}

(function() {
    console.log('Initializing webview script...');
    const vscode = acquireVsCodeApi();
    let formInitialized = false;

    function validateForm(data: BackportFormData): { isValid: boolean; error?: string } {
        if (!data.versions || !data.cherryPickCommit) {
            return { isValid: false, error: 'Versions and Cherry-pick branch are required' };
        }
    
        const hasNewRepoName = data.newRepoName.trim() !== '';
        const hasRepoName = data.repoName.trim() !== '';
    
        if (!hasNewRepoName && !hasRepoName) {
            return { isValid: false, error: 'Please select a repository or enter a new repository name.' };
        }
    
        if (hasNewRepoName && hasRepoName) {
            return { isValid: false, error: 'Please provide either a new repository name or select an existing one, not both.' };
        }
    
        return { isValid: true };
    }

    function initializeForm() {
        if (formInitialized) {
            console.log('Form already initialized');
            return;
        }
    
        const form = document.getElementById('backportForm') as HTMLFormElement;
        const submitButton = document.getElementById('submitButton') as HTMLButtonElement;
        const repoNameSelect = document.getElementById('repoName') as HTMLSelectElement;
        const newRepoNameInput = document.getElementById('newRepoName') as HTMLInputElement;
    
        if (!form || !submitButton || !repoNameSelect || !newRepoNameInput) {
            console.error('Required elements not found');
            return;
        }
    
        console.log('Initializing form elements...');
    
        // Event listener for repoName select
        repoNameSelect.addEventListener('change', () => {
            if (repoNameSelect.value) {
                newRepoNameInput.disabled = true;
            } else {
                newRepoNameInput.disabled = false;
            }
        });
    
        // Event listener for newRepoName input
        newRepoNameInput.addEventListener('input', () => {
            if (newRepoNameInput.value.trim()) {
                repoNameSelect.disabled = true;
            } else {
                repoNameSelect.disabled = false;
            }
        });
    
        // Add click listener to submit button
        submitButton.addEventListener('click', () => {
            console.log('Submit button clicked');
            try {
                const formData = new FormData(form);
                const data: BackportFormData = {
                    newRepoName: formData.get('newRepoName') as string || '',
                    repoName: formData.get('repoName') as string || '',
                    versions: formData.get('versions') as string || '',
                    cherryPickCommit: formData.get('cherryPickCommit') as string || ''
                };
    
                console.log('Form data:', data);
    
                const validation = validateForm(data);
                if (!validation.isValid) {
                    console.error('Validation failed:', validation.error);
                    vscode.postMessage({
                        type: 'error',
                        payload: validation.error
                    });
                    return;
                }
    
                console.log('Sending validated data:', data);
                vscode.postMessage({
                    type: 'formSubmit',
                    payload: data
                });
    
            } catch (error) {
                console.error('Error processing form:', error);
                vscode.postMessage({
                    type: 'error',
                    payload: error instanceof Error ? error.message : 'Unknown error occurred'
                });
            }
        });
    
        formInitialized = true;
        console.log('Form initialization complete');
    }

    // Initialize immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeForm);
    } else {
        initializeForm();
    }

    // Send test message to verify communication
    vscode.postMessage({ 
        type: 'test',
        payload: 'Script loaded and initialized'
    });
})();