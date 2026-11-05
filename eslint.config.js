import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // With noUncheckedIndexedAccess, index access in the geometry maths needs `!` where bounds are known.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["server/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "*.config.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    extends: [js.configs.recommended],
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },
);
