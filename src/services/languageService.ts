import * as vscode from "vscode";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";

export class LanguageService {
  private currentLanguage: string;
  private defaultLanguage: string;
  private languageStrings: Record<string, Record<string, string>> = {};

  constructor(private readonly context: vscode.ExtensionContext) {
    // First clear any existing language preference
    this.context.globalState.update("preferredLanguage", undefined);

    // Load language strings first
    this.loadLanguageStrings();

    // Set default from yaml
    this.defaultLanguage = Object.keys(this.languageStrings)[0] || "en";
    this.currentLanguage = this.defaultLanguage;

    // Only allow overriding with saved preference if it's valid
    const savedLanguage =
      this.context.globalState.get<string>("preferredLanguage");
    console.log("[LanguageService] Saved language preference:", savedLanguage);

    if (savedLanguage && this.languageStrings[savedLanguage]) {
      this.currentLanguage = savedLanguage;
    } else {
      this.context.globalState.update(
        "preferredLanguage",
        this.defaultLanguage,
      );
    }
    console.log(
      "[LanguageService] Initialized with language:",
      this.currentLanguage,
    );
  }

  private loadLanguageStrings(): void {
    try {
      // Try multiple possible paths
      const possiblePaths = [
        path.join(this.context.extensionPath, "src", "config", "languages.yml"),
        path.join(
          this.context.extensionPath,
          "dist",
          "config",
          "languages.yml",
        ),
        path.join(this.context.extensionPath, "config", "languages.yml"),
        path.join(this.context.extensionPath, "out", "config", "languages.yml"),
      ];

      console.log("Extension path:", this.context.extensionPath);

      for (const configPath of possiblePaths) {
        console.log("Checking path:", configPath);
        if (fs.existsSync(configPath)) {
          console.log("Found language file at:", configPath);
          const fileContents = fs.readFileSync(configPath, "utf8");
          this.languageStrings = yaml.load(fileContents) as Record<
            string,
            Record<string, string>
          >;
          console.log(
            "[LanguageService] Available languages:",
            Object.keys(this.languageStrings),
          );
          return;
        }
      }

      throw new Error("Could not find languages.yml in any expected location");
    } catch (error) {
      console.error("Failed to load language strings:", error);
    }
  }

  // used in webviewService for language selection
  getString(key: string, language?: string): string {
    const lang = language || this.currentLanguage;
    return this.languageStrings[lang]?.[key] || key;
  }

  getStringsForLanguage(language: string): Record<string, string> {
    return this.languageStrings[language] || {};
  }

  async changeLanguage(newLanguage: string): Promise<void> {
    console.log(
      "[LanguageService] Changing language from",
      this.currentLanguage,
      "to",
      newLanguage,
    );

    // Store current language before attempting change
    const previousLanguage = this.currentLanguage;

    if (!this.languageStrings[newLanguage]) {
      vscode.window.showErrorMessage(this.getString("error_invalid_language"));
      // Keep previous language
      this.currentLanguage = previousLanguage;
      await this.context.globalState.update(
        "preferredLanguage",
        previousLanguage,
      );
      return;
    }

    this.currentLanguage = newLanguage;
    await this.context.globalState.update("preferredLanguage", newLanguage);
    console.log("[LanguageService] Language updated to:", this.currentLanguage);
  }

  getCurrentLanguage(): string {
    console.log(
      "[LanguageService] Getting current language:",
      this.currentLanguage,
    );
    return this.currentLanguage || this.defaultLanguage;
  }

  getAvailableLanguages(): string[] {
    return Object.keys(this.languageStrings);
  }
}
