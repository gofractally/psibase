module.exports = {
    root: true,
    env: { browser: true, es2020: true },
    extends: ["plugin:prettier/recommended", "plugin:react-hooks/recommended"],
    ignorePatterns: ["dist", ".eslintrc.cjs"],
    parser: "@typescript-eslint/parser",
    plugins: ["prettier", "@typescript-eslint", "react-refresh"],
    rules: {
        quotes: ["error", "double"],
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            { argsIgnorePattern: "^_" },
        ],
        "no-nested-ternary": "off",
        "react-refresh/only-export-components": [
            "warn",
            { allowConstantExport: true },
        ],
    },
};
