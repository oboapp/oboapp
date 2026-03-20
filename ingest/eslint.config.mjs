import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const eslintConfig = [
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Code quality rules - TypeScript-aware unused vars detection
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          args: "none",
        },
      ],

      // Memory leak prevention rules
      "prefer-const": "error",
      "no-var": "error",

      // Prefer early returns over else-if-return chains
      "no-else-return": ["error", { allowElseIf: false }],

      // Ban type assertions (as X) - use type guards or proper typing instead
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
    },
  },
  // Allow 'any' and type assertions in test files, mocks, and scripts for testing/utility purposes
  {
    files: [
      "**/*.test.ts",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/scripts/**",
      "**/tmp/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "coverage/**",
      "**/*.d.ts", // Type declaration files
      "emulator-data/**",
      "terraform/**/.terraform/**",
      "**/*.mjs", // Config files not in tsconfig
    ],
  },
];

export default eslintConfig;
