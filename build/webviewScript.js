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
    function loadSavedVersions() {
        var repoSelect = document.getElementById('repoName');
        var selectedRepo = repoSelect.value;
        console.log('Loading versions for repo:', selectedRepo);
        vscode.postMessage({ type: 'loadSavedVersions', repoName: selectedRepo });
    }
    function displaySavedVersions(versions) {
        var container = document.getElementById('savedVersions');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        versions.forEach(function (version) {
            var versionSpan = document.createElement('div');
            versionSpan.className = 'version-item';
            var addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = version;
            addButton.className = 'version-add';
            addButton.onclick = function () { return addVersion(version); };
            var deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = '×';
            deleteButton.className = 'version-delete';
            deleteButton.title = 'Remove version';
            deleteButton.onclick = function () { return deleteVersion(version); };
            versionSpan.appendChild(addButton);
            versionSpan.appendChild(deleteButton);
            container.appendChild(versionSpan);
        });
    }
    function addVersion(version) {
        var versionsInput = document.getElementById('versions');
        var versions = versionsInput.value.split(',').map(function (v) { return v.trim(); }).filter(function (v) { return v; });
        if (!versions.includes(version)) {
            versions.push(version);
            versionsInput.value = versions.join(', ');
        }
    }
    function deleteVersion(version) {
        var repoSelect = document.getElementById('repoName');
        var selectedRepo = repoSelect.value;
        vscode.postMessage({ type: 'deleteVersion', repoName: selectedRepo, version: version });
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
        var newRepoNameLabel = document.querySelector('label[for="newRepoName"]');
        if (!form || !submitButton || !repoNameSelect || !newRepoNameInput) {
            console.error('Required elements not found');
            return;
        }
        console.log('Initializing form elements...');
        // Event listener for repoName select
        repoNameSelect.addEventListener('change', function () {
            if (repoNameSelect.value) {
                newRepoNameInput.disabled = true;
                newRepoNameLabel.classList.add('disabled');
                loadSavedVersions();
            }
            else {
                newRepoNameInput.disabled = false;
                newRepoNameLabel.classList.remove('disabled');
                document.getElementById('savedVersions').innerHTML = '';
            }
        });
        // Event listener for newRepoName input
        newRepoNameInput.addEventListener('input', function () {
            if (newRepoNameInput.value.trim()) {
                repoNameSelect.disabled = true;
                document.getElementById('savedVersions').innerHTML = '';
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
        // Optionally load saved versions if a repository is already selected
        if (repoNameSelect.value) {
            loadSavedVersions();
        }
        formInitialized = true;
        console.log('Form initialization complete');
    }
    window.addEventListener('message', function (event) {
        var message = event.data;
        switch (message.type) {
            case 'savedVersions':
                displaySavedVersions(message.versions);
                break;
            case 'error':
                // Display error in UI
                showError(message.payload);
                break;
            case 'success':
                // Clear form and show success message
                handleSuccess(message.payload);
                break;
            case 'loading':
                // Show/hide loading state
                setLoading(message.payload);
                break;
            case 'validationError':
                // Show validation error in UI
                showValidationError(message.payload);
                break;
        }
    });
    function showError(message) {
        var errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.color = '#cc0000';
        errorDiv.style.marginBottom = '10px';
        var form = document.getElementById('backportForm');
        form === null || form === void 0 ? void 0 : form.insertBefore(errorDiv, form.firstChild);
        setTimeout(function () { return errorDiv.remove(); }, 5000);
    }
    function handleSuccess(message) {
        // Clear form
        var form = document.getElementById('backportForm');
        form.reset();
        // Clear saved versions display
        document.getElementById('savedVersions').innerHTML = '';
        // Show success message
        var successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        successDiv.style.color = '#28a745';
        successDiv.style.marginBottom = '10px';
        form.insertBefore(successDiv, form.firstChild);
        setTimeout(function () { return successDiv.remove(); }, 5000);
    }
    function setLoading(isLoading) {
        var submitButton = document.getElementById('submitButton');
        if (isLoading) {
            submitButton.disabled = true;
            submitButton.textContent = 'Processing...';
        }
        else {
            submitButton.disabled = false;
            submitButton.textContent = 'Start Backport';
        }
    }
    function showValidationError(message) {
        var versionsInput = document.getElementById('versions');
        versionsInput.setCustomValidity(message);
        versionsInput.reportValidity();
        setTimeout(function () { return versionsInput.setCustomValidity(''); }, 5000);
    }
    // Initialize form when DOM is ready
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
