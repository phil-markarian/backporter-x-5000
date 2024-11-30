import * as vscode from "vscode";

export class UIHelper {
  async promptUser(message: string): Promise<string> {
    console.log("Prompting user:", message);

    // For merge conflict resolution, use QuickPick instead of InputBox
    if (message.includes("Conflicts occurred")) {
      const options: vscode.QuickPickItem[] = [
        { label: "Yes", description: "Resolve conflicts now" },
        { label: "No", description: "Abort cherry-pick" },
      ];

      const selection = await vscode.window.showQuickPick(options, {
        placeHolder: message,
        ignoreFocusOut: true,
        canPickMany: false,
      });

      return selection?.label || "No";
    }

    // For other prompts, use InputBox
    const input = await vscode.window.showInputBox({
      prompt: message,
      ignoreFocusOut: true,
    });

    return input || "";
  }
}
