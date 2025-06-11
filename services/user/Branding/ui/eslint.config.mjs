import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
    { ignores: ["dist", "node_modules"] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            "react-hooks": reactHooks,
        },
    },
    eslintConfigPrettier,
);
