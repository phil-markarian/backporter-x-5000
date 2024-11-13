(function () {
    console.log('Initializing webview script...');
    var vscode = acquireVsCodeApi();
    var formInitialized = false;
    function validateForm(data) {
        if (!data.versions || !data.cherryPickCommit) {
            return { isValid: false, error: 'Versions and Cherry-pick branch are required' };
        }
        var hasNewRepoName = data.newRepoName.trim() !== '';
        var hasRepoName = data.repoName.trim() !== '';
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
        var form = document.getElementById('backportForm');
        var submitButton = document.getElementById('submitButton');
        var repoNameSelect = document.getElementById('repoName');
        var newRepoNameInput = document.getElementById('newRepoName');
        if (!form || !submitButton || !repoNameSelect || !newRepoNameInput) {
            console.error('Required elements not found');
            return;
        }
        console.log('Initializing form elements...');
        // Event listener for repoName select
        repoNameSelect.addEventListener('change', function () {
            if (repoNameSelect.value) {
                newRepoNameInput.disabled = true;
            }
            else {
                newRepoNameInput.disabled = false;
            }
        });
        // Event listener for newRepoName input
        newRepoNameInput.addEventListener('input', function () {
            if (newRepoNameInput.value.trim()) {
                repoNameSelect.disabled = true;
            }
            else {
                repoNameSelect.disabled = false;
            }
        });
        // Add click listener to submit button
        submitButton.addEventListener('click', function () {
            console.log('Submit button clicked');
            try {
                var formData = new FormData(form);
                var data = {
                    newRepoName: formData.get('newRepoName') || '',
                    repoName: formData.get('repoName') || '',
                    versions: formData.get('versions') || '',
                    cherryPickCommit: formData.get('cherryPickCommit') || ''
                };
                console.log('Form data:', data);
                var validation = validateForm(data);
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
            }
            catch (error) {
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
    }
    else {
        initializeForm();
    }
    // Send test message to verify communication
    vscode.postMessage({
        type: 'test',
        payload: 'Script loaded and initialized'
    });
})();
