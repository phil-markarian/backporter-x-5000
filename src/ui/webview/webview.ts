declare function acquireVsCodeApi(): any;

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

    function loadSavedVersions() {
        const repoSelect = document.getElementById('repoName') as HTMLSelectElement;
        const selectedRepo = repoSelect.value;
        console.log('Loading versions for repo:', selectedRepo);
        vscode.postMessage({ 
            type: 'loadSavedVersions', 
            payload: { repoName: selectedRepo }
        });
    }

    function displaySavedVersions(versions: string[]) {
        const container = document.getElementById('savedVersions');
        if (!container) { return; }
        container.innerHTML = '';
        versions.forEach(version => {
            const versionSpan = document.createElement('div');
            versionSpan.className = 'version-item';
            
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = version;
            addButton.className = 'version-add';
            addButton.onclick = () => addVersion(version);
    
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = '×';
            deleteButton.className = 'version-delete';
            deleteButton.title = 'Remove version';
            deleteButton.onclick = () => deleteVersion(version);
    
            versionSpan.appendChild(addButton);
            versionSpan.appendChild(deleteButton);
            container.appendChild(versionSpan);
        });
    }

    function addVersion(version: string) {
        const versionsInput = document.getElementById('versions') as HTMLInputElement;
        let versions = versionsInput.value.split(',').map(v => v.trim()).filter(v => v);
        if (!versions.includes(version)) {
            versions.push(version);
            versionsInput.value = versions.join(', ');
        }
    }

    function deleteVersion(version: string) {
        const repoSelect = document.getElementById('repoName') as HTMLSelectElement;
        const selectedRepo = repoSelect.value;
        vscode.postMessage({ 
            type: 'deleteVersion', 
            payload: { repoName: selectedRepo, version }
        });
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
        const newRepoNameLabel = document.querySelector('label[for="newRepoName"]') as HTMLLabelElement;
    
        if (!form || !submitButton || !repoNameSelect || !newRepoNameInput) {
            console.error('Required elements not found');
            return;
        }
    
        console.log('Initializing form elements...');
    
        // Event listener for repoName select
        repoNameSelect.addEventListener('change', () => {
            const selectedValue = repoNameSelect.value;
            if (selectedValue) {
                newRepoNameInput.disabled = true;
                newRepoNameLabel.classList.add('disabled');
                loadSavedVersions();
            } else {
                newRepoNameInput.disabled = false;
                newRepoNameLabel.classList.remove('disabled');
                document.getElementById('savedVersions')!.innerHTML = '';
            }
        });
    
        // Event listener for newRepoName input
        newRepoNameInput.addEventListener('input', () => {
            if (newRepoNameInput.value.trim()) {
                repoNameSelect.disabled = true;
                document.getElementById('savedVersions')!.innerHTML = '';
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
    
        // Optionally load saved versions if a repository is already selected
        if (repoNameSelect.value) {
            loadSavedVersions();
        }

        formInitialized = true;
        console.log('Form initialization complete');
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'savedVersions':
                displaySavedVersions(message.versions);
                break;
    
            case 'error':
                showError(message.payload);
                break;
    
            case 'success':
                handleSuccess(message.payload);
                break;
    
            case 'loading':
                setLoading(message.payload);
                break;
    
            case 'validationError':
                showValidationError(message.payload);
                break;
        }
    });

    function showError(message: string) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.color = '#cc0000';
        errorDiv.style.marginBottom = '10px';
        
        const form = document.getElementById('backportForm');
        form?.insertBefore(errorDiv, form.firstChild);
        
        setTimeout(() => errorDiv.remove(), 5000);
    }
    
    function handleSuccess(message: string) {
        const form = document.getElementById('backportForm') as HTMLFormElement;
        form.reset();
        
        document.getElementById('savedVersions')!.innerHTML = '';
        
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        successDiv.style.color = '#28a745';
        successDiv.style.marginBottom = '10px';
        
        form.insertBefore(successDiv, form.firstChild);
        setTimeout(() => successDiv.remove(), 5000);
    }
    
    function setLoading(isLoading: boolean) {
        const submitButton = document.getElementById('submitButton') as HTMLButtonElement;
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? 'Processing...' : 'Start Backport';
    }
    
    function showValidationError(message: string) {
        const versionsInput = document.getElementById('versions') as HTMLInputElement;
        versionsInput.setCustomValidity(message);
        versionsInput.reportValidity();
        setTimeout(() => versionsInput.setCustomValidity(''), 5000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeForm);
    } else {
        initializeForm();
    }

    vscode.postMessage({ 
        type: 'test',
        payload: 'Script loaded and initialized'
    });
})();