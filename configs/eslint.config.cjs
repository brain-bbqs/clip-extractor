// Loaded by `npm run lint`. CommonJS (.cjs) so require() can load it despite "type": "module".
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const path = require("node:path");

module.exports = tseslint.config(
  {
    ignores: ["dist/", "coverage/", "storybook-static/", "test-results/", "playwright-report/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware linting for everything the TypeScript project covers (src/ plus the *.ts files
    // under configs/; tests/ is outside the tsconfig, so type information is not available there).
    files: ["src/**/*.ts", "configs/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: path.join(__dirname, ".."),
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    // Deterministic complexity caps everywhere, type info not required.
    rules: {
      complexity: ["error", 20],
      "max-depth": ["error", 4],
    },
  },
  {
    // CommonJS config files use CJS globals and require() by definition.
    files: ["**/*.cjs"],
    languageOptions: { globals: { module: "writable", require: "readonly", __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
