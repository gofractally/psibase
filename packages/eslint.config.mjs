import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import * as reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist", "node_modules"] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            "no-unused-vars": "off", // Disable the base ESLint rule
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    varsIgnorePattern: "^_", // Ignore variables starting with '_'
                    argsIgnorePattern: "^_", // Ignore parameters starting with '_'
                },
            ],
        },
    },
    reactHooks.configs["recommended-latest"],
    eslintConfigPrettier,
);
