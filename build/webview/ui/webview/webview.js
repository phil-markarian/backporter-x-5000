"use strict";
(function () {
    console.log('Initializing webview script...');
    const vscode = acquireVsCodeApi();
    let formInitialized = false;
    let strings = window.initialStrings || {};
    let currentLanguage = window.currentLanguage || 'en';
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message:', message);
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
            case 'initialLanguage':
                console.log('[DEBUG] Processing initialLanguage message');
                currentLanguage = message.payload;
                console.log('Initial language set to:', currentLanguage);
                break;
            case 'languageUpdate':
                currentLanguage = message.payload.language;
                console.log('[DEBUG] Updating UI language to:', currentLanguage);
                updateUIStrings(message.payload.strings);
                break;
        }
    });
    vscode.postMessage({ type: 'webviewReady' });
    console.log('Webview is ready, sent webviewReady message');
    // Initialize the form
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeForm);
    }
    else {
        initializeForm();
    }
    let formElements = {};
    function initializeFormElements() {
        formElements = {
            form: document.getElementById('backportForm'),
            submitButton: document.getElementById('submitButton'),
            repoNameSelect: document.getElementById('repoName'),
            versionsInput: document.getElementById('versions'),
            newRepoNameInput: document.getElementById('newRepoName'),
            cherryPickInput: document.getElementById('cherryPickCommit'),
            newRepoNameLabel: document.querySelector('label[for="newRepoName"]'),
            languageSelector: document.getElementById('languageSelector'),
            commitError: document.getElementById('commitError')
        };
        // Only check critical elements
        const requiredElements = [
            'form',
            'submitButton',
            'repoNameSelect',
            'versionsInput',
            'newRepoNameInput',
            'cherryPickInput'
        ];
        const missingElements = requiredElements.filter(elementName => !formElements[elementName]);
        if (missingElements.length > 0) {
            console.error('Missing required elements:', missingElements);
            return false;
        }
        return true;
    }
    function validateFormState() {
        const hasRepo = formElements.repoNameSelect?.value.trim() || formElements.newRepoNameInput?.value.trim();
        const hasVersions = formElements.versionsInput?.value.trim();
        const hasCherryPick = formElements.cherryPickInput?.value.trim();
        // Validate commit hash format
        let isValidCommit = false;
        if (hasCherryPick) {
            const commitRegex = /^[0-9a-f]{7,40}$/i;
            isValidCommit = commitRegex.test(hasCherryPick);
            // Show/hide error message
            if (!isValidCommit && formElements.commitError) {
                formElements.commitError.textContent = strings.invalid_commit_format;
                formElements.commitError.style.display = 'block';
            }
            else if (formElements.commitError) {
                formElements.commitError.style.display = 'none';
            }
        }
        const isValid = Boolean(hasRepo && hasVersions && hasCherryPick && isValidCommit);
        if (formElements.submitButton) {
            formElements.submitButton.disabled = !isValid;
        }
        return isValid;
    }
    function updateUIStrings(strings) {
        // Update form labels and placeholders
        const elementsToUpdate = {
            'repoName': strings.repo_name_label,
            'repoNamePlaceholder': strings.select_repository, // Add placeholder
            'newRepoName': strings.new_repo_label,
            'savedVersions': strings.saved_versions_label,
            'versions': strings.versions_label,
            'cherryPickCommit': strings.cherry_pick_label,
            'submitButton': strings.submit_button
        };
        for (const [id, text] of Object.entries(elementsToUpdate)) {
            // Special handling for repository select placeholder
            if (id === 'repoNamePlaceholder') {
                const repoSelect = document.getElementById('repoName');
                if (repoSelect) {
                    const placeholderOption = repoSelect.querySelector('option[value=""]');
                    if (placeholderOption) {
                        placeholderOption.textContent = text;
                    }
                }
                continue;
            }
            // Regular element updates
            const element = document.querySelector(`label[for="${id}"]`) || document.getElementById(id);
            if (element) {
                if (element.tagName === 'LABEL') {
                    element.textContent = text;
                }
                else if (element.tagName === 'BUTTON') {
                    element.textContent = text;
                }
            }
        }
        // Rest of the function remains the same...
        const languageSelector = document.getElementById('languageSelector');
        if (languageSelector) {
            const options = languageSelector.options;
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                if (opt.value === 'en') {
                    opt.textContent = strings.language_en;
                }
                else if (opt.value === 'ja') {
                    opt.textContent = strings.language_ja;
                }
            }
        }
    }
    function validateForm(data) {
        if (!data.versions || !data.cherryPickCommit) {
            return { isValid: false, error: strings.validation_versions_cherry_pick_required };
        }
        const hasNewRepoName = data.newRepoName.trim() !== '';
        const hasRepoName = data.repoName.trim() !== '';
        if (!hasNewRepoName && !hasRepoName) {
            return { isValid: false, error: strings.validation_repo_name_required };
        }
        if (hasNewRepoName && hasRepoName) {
            return { isValid: false, error: strings.validation_repo_name_conflict };
        }
        return { isValid: true };
    }
    function loadSavedVersions() {
        const repoSelect = document.getElementById('repoName');
        const selectedRepo = repoSelect.value;
        console.log('Loading versions for repo:', selectedRepo);
        vscode.postMessage({
            type: 'loadSavedVersions',
            payload: { repoName: selectedRepo }
        });
    }
    function displaySavedVersions(versions) {
        const container = document.getElementById('savedVersions');
        if (!container) {
            return;
        }
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
            deleteButton.title = strings.remove_version; // Replace hardcoded title
            deleteButton.onclick = () => deleteVersion(version);
            versionSpan.appendChild(addButton);
            versionSpan.appendChild(deleteButton);
            container.appendChild(versionSpan);
        });
    }
    function addVersion(version) {
        if (!formElements.versionsInput) {
            return;
        }
        let versions = formElements.versionsInput.value.split(',').map(v => v.trim()).filter(v => v);
        if (!versions.includes(version)) {
            versions.push(version);
            formElements.versionsInput.value = versions.join(', ');
        }
        validateFormState();
    }
    function deleteVersion(version) {
        const repoSelect = document.getElementById('repoName');
        const selectedRepo = repoSelect.value;
        vscode.postMessage({
            type: 'deleteVersion',
            payload: { repoName: selectedRepo, version }
        });
    }
    function initializeForm() {
        // Prevent multiple initializations
        if (formInitialized) {
            console.log('Form already initialized');
            return;
        }
        // Initialize form elements
        if (!initializeFormElements()) {
            console.error('Required elements not found');
            return;
        }
        // Set up language selector
        formElements.languageSelector?.addEventListener('change', (e) => {
            const newLanguage = e.target.value;
            console.log('[Webview] Language change requested:', newLanguage);
            vscode.postMessage({
                type: 'languageChange',
                payload: { language: newLanguage }
            });
        });
        // Add validation listeners
        formElements.repoNameSelect?.addEventListener('change', () => {
            if (!formElements.newRepoNameInput || !formElements.newRepoNameLabel) {
                return;
            }
            const selectedValue = formElements.repoNameSelect?.value;
            if (selectedValue) {
                formElements.newRepoNameInput.disabled = true;
                formElements.newRepoNameLabel.classList.add('disabled');
                loadSavedVersions();
            }
            else {
                formElements.newRepoNameInput.disabled = false;
                formElements.newRepoNameLabel.classList.remove('disabled');
                document.getElementById('savedVersions').innerHTML = '';
            }
            validateFormState();
        });
        formElements.newRepoNameInput?.addEventListener('input', () => {
            if (!formElements.repoNameSelect) {
                return;
            }
            if (formElements.newRepoNameInput?.value.trim()) {
                formElements.repoNameSelect.disabled = true;
                document.getElementById('savedVersions').innerHTML = '';
            }
            else {
                formElements.repoNameSelect.disabled = false;
            }
            validateFormState();
        });
        formElements.versionsInput?.addEventListener('input', validateFormState);
        formElements.cherryPickInput?.addEventListener('input', validateFormState);
        // Form submission handler
        formElements.submitButton?.addEventListener('click', () => {
            if (!formElements.form) {
                return;
            }
            console.log('Submit button clicked');
            try {
                const formData = new FormData(formElements.form);
                const data = {
                    newRepoName: formData.get('newRepoName') || '',
                    repoName: formData.get('repoName') || '',
                    versions: formData.get('versions') || '',
                    cherryPickCommit: formData.get('cherryPickCommit') || ''
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
            }
            catch (error) {
                console.error('Error processing form:', error);
                vscode.postMessage({
                    type: 'error',
                    payload: error instanceof Error ? error.message : strings.unknown_error_occurred
                });
            }
        });
        // Load saved versions if repo is pre-selected
        if (formElements.repoNameSelect?.value) {
            loadSavedVersions();
        }
        // Initial button state
        validateFormState();
        formInitialized = true;
        console.log('Form initialization complete');
    }
    window.onerror = function (msg, url, line, col, error) {
        console.error('[Webview] Error:', { msg, url, line, col, error });
        return false;
    };
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.color = '#cc0000';
        errorDiv.style.marginBottom = '10px';
        const form = document.getElementById('backportForm');
        form?.insertBefore(errorDiv, form.firstChild);
        setTimeout(() => errorDiv.remove(), 5000);
    }
    function handleSuccess(message) {
        const form = document.getElementById('backportForm');
        form.reset();
        document.getElementById('savedVersions').innerHTML = '';
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        successDiv.style.color = '#28a745';
        successDiv.style.marginBottom = '10px';
        form.insertBefore(successDiv, form.firstChild);
        setTimeout(() => successDiv.remove(), 5000);
    }
    function setLoading(isLoading) {
        const submitButton = document.getElementById('submitButton');
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? strings.processing_label : strings.submit_button;
    }
    function showValidationError(message) {
        const versionsInput = document.getElementById('versions');
        versionsInput.setCustomValidity(message);
        versionsInput.reportValidity();
        setTimeout(() => versionsInput.setCustomValidity(''), 5000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeForm);
    }
    else {
        initializeForm();
    }
    vscode.postMessage({
        type: 'test',
        payload: 'Script loaded and initialized'
    });
})();
//# sourceMappingURL=webview.js.map