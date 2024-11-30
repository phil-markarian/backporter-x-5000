declare function acquireVsCodeApi(): any;

(function () {
  const vscode = acquireVsCodeApi();

  document.getElementById("usePRButton")?.addEventListener("click", () => {
    const title =
      (document.getElementById("prTitle") as HTMLInputElement)?.value || "";
    const body =
      (document.getElementById("prBody") as HTMLTextAreaElement)?.value || "";
    vscode.postMessage({
      type: "usePR",
      title,
      body,
    });
  });

  document.getElementById("searchButton")?.addEventListener("click", () => {
    const searchBox = document.querySelector(".search-box") as HTMLElement;
    if (searchBox) {
      searchBox.style.display = "block";
    }
  });

  document.getElementById("prSearch")?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (value.length > 2) {
      vscode.postMessage({
        type: "searchPR",
        query: value,
      });
    }
  });

  document.getElementById("saveButton")?.addEventListener("click", () => {
    const title =
      (document.getElementById("prTitle") as HTMLInputElement)?.value || "";
    const body =
      (document.getElementById("prBody") as HTMLTextAreaElement)?.value || "";
    vscode.postMessage({
      type: "usePR",
      title,
      body,
    });
  });
})();
