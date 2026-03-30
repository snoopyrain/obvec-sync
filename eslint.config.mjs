import tsParser from "@typescript-eslint/parser";
import obsidianPlugin from "/tmp/obsidian-eslint/dist/lib/index.js";

export default [{
  files: ["**/*.ts"],
  languageOptions: { parser: tsParser },
  plugins: { obsidianmd: obsidianPlugin },
  rules: { "obsidianmd/ui/sentence-case": "error" },
}];
