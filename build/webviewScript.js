(function () {
    var _a, _b, _c;
    var vscode = acquireVsCodeApi();
    var branchCount = 1;
    (_a = document.getElementById('addBranch')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', function () {
        var _a;
        branchCount++;
        var branchDiv = document.createElement('div');
        branchDiv.className = 'branch-input';
        branchDiv.innerHTML = "\n            <label for=\"branch".concat(branchCount, "\">Branch ").concat(branchCount, ":</label>\n            <input type=\"text\" id=\"branch").concat(branchCount, "\" name=\"branch").concat(branchCount, "\" required>\n        ");
        (_a = document.getElementById('branches')) === null || _a === void 0 ? void 0 : _a.appendChild(branchDiv);
    });
    (_b = document.getElementById('removeBranch')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', function () {
        var _a, _b;
        if (branchCount > 1) {
            (_b = (_a = document.getElementById('branches')) === null || _a === void 0 ? void 0 : _a.lastChild) === null || _b === void 0 ? void 0 : _b.remove();
            branchCount--;
        }
    });
    (_c = document.getElementById('cherryPickForm')) === null || _c === void 0 ? void 0 : _c.addEventListener('submit', function (event) {
        event.preventDefault();
        var formData = new FormData(event.target);
        var data = {};
        formData.forEach(function (value, key) {
            data[key] = value;
        });
        vscode.postMessage(data);
    });
}());
