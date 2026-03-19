import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const eslintConfig = [
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["src/*.test.ts"],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          args: "none",
        },
      ],
      "prefer-const": "error",
      "no-var": "error",

      // Ban type assertions (as X) - use type guards or proper typing instead
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
    },
  },
  // Allow type assertions in test files (Stage 2 will ban these too)
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts", "**/*.mjs"],
  },
];

export default eslintConfig;
