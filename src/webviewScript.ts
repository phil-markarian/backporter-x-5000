declare function acquireVsCodeApi(): any;

(function() {
    const vscode = acquireVsCodeApi();

    document.addEventListener('DOMContentLoaded', () => {
        console.log('Script loaded and DOM fully loaded');

        const backportForm = document.getElementById('backportForm');

        if (backportForm) {
            backportForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const formData = new FormData(event.target as HTMLFormElement);
                const data: { [key: string]: string } = {};
                formData.forEach((value, key) => {
                    data[key] = value as string;
                });
                vscode.postMessage(data);
            });
        } else {
            console.error('Required elements not found in the DOM');
        }
    });
}());