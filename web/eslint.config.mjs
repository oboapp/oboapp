import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const eslintConfig = [
  ...nextVitals,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Memory leak prevention rules
      "react-hooks/exhaustive-deps": "error",
      "prefer-const": "error",
      "no-var": "error",

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
      // Allow empty object types for generic type parameters (used in analytics)
      "@typescript-eslint/no-empty-object-type": "off",

      // Prefer early returns over else-if-return chains
      "no-else-return": ["error", { allowElseIf: false }],

      // Ban type assertions (as X) - use type guards or proper typing instead
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],

      // React/JSX rules
      "react/button-has-type": [
        "error",
        {
          button: true,
          submit: true,
          reset: true,
        },
      ],

      // Discourage console statements — use proper error handling instead
      "no-console": "warn",
    },
  },
  // Allow 'any' and type assertions in test files for mocking purposes
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "**/__mocks__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
      "coverage/**",
      "**/*.d.ts", // Type declaration files
      "**/*.mjs", // Config files not in tsconfig
      "public/firebase-messaging-sw.js", // Service worker not in tsconfig
      "public/mockServiceWorker.js", // MSW service worker generated file
    ],
  },
];

export default eslintConfig;
