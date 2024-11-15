"use strict";
(function () {
    const vscode = acquireVsCodeApi();
    document.getElementById('usePRButton')?.addEventListener('click', () => {
        const title = document.getElementById('prTitle')?.value || '';
        const body = document.getElementById('prBody')?.value || '';
        vscode.postMessage({
            type: 'usePR',
            title,
            body
        });
    });
    document.getElementById('searchButton')?.addEventListener('click', () => {
        const searchBox = document.querySelector('.search-box');
        if (searchBox) {
            searchBox.style.display = 'block';
        }
    });
    document.getElementById('prSearch')?.addEventListener('input', (e) => {
        const value = e.target.value;
        if (value.length > 2) {
            vscode.postMessage({
                type: 'searchPR',
                query: value
            });
        }
    });
    document.getElementById('saveButton')?.addEventListener('click', () => {
        const title = document.getElementById('prTitle')?.value || '';
        const body = document.getElementById('prBody')?.value || '';
        vscode.postMessage({
            type: 'usePR',
            title,
            body
        });
    });
})();
//# sourceMappingURL=prSelection.js.map