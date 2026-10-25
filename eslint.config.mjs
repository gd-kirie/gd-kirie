import antfu from "@antfu/eslint-config";

export default antfu(
  {
    type: "lib",
    typescript: true,
    stylistic: {
      indent: 2,
      quotes: "double",
      semi: true,
      braceStyle: "1tbs",
    },
    formatters: {
      css: true,
      html: true,
    },
    markdown: false,
    toml: false,
    yaml: false,
    pnpm: false,
    ignores: ["scripts/run-build-task.js", "**/.build/**", "**/.generated/**"],
  },
  {
    files: ["**/*.{js,ts,tsx}"],
    rules: {
      "import/consistent-type-specifier-style": "off",
      "node/prefer-global/process": "off",
      "node/prefer-global/buffer": "off",
      "regexp/prefer-w": "off",
      "regexp/use-ignore-case": "off",
      "style/arrow-parens": ["error", "always"],
      "style/operator-linebreak": [
        "error",
        "after",
        {
          overrides: { "?": "before", ":": "before" },
        },
      ],
      "ts/method-signature-style": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "ts/consistent-type-definitions": ["error", "interface"],
    },
  },
  {
    files: ["**/*.json", "**/*.jsonc"],
    rules: {
      "jsonc/sort-keys": "off",
      "jsonc/sort-array-values": "off",
    },
  },
  {
    files: ["packages/cli/kirie.js"],
    rules: {
      "antfu/no-import-dist": "off",
    },
  },
  {
    files: ["packages/build/src/dotnet.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["packages/cli/src/commands/doctor/index.ts"],
    rules: {
      "ts/no-redeclare": "off",
    },
  },
  {
    files: ["packages/cli/src/commands/doctor/index.test.ts"],
    rules: {
      "test/prefer-lowercase-title": "off",
    },
  },
  {
    files: ["packages/ipc/src/index.ts"],
    rules: {
      "ts/no-use-before-define": "off",
    },
  },
  {
    files: ["**/src-godot/**/*.ts"],
    rules: {
      // The converter uses declaration merging to emit GDScript class constants.
      "ts/no-namespace": "off",
      // The converter drops shorthand fields from emitted Dictionary literals.
      "object-shorthand": "off",
      "style/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "block-like", next: "*" },
      ],
      "ts/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["snake_case", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "method",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "classProperty",
          format: ["snake_case", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
      ],
    },
  },
);
