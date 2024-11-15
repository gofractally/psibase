module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        ecmaFeatures: {
            jsx: true,
        },
    },
    settings: {
        react: {
            version: "detect",
        },
        "import/core-modules": ["@psibase/common-lib"],
        "import/resolver": {
            node: {
                paths: ["src"],
                extensions: [".js", ".jsx", ".ts", ".tsx"],
            },
        },
    },
    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    extends: [
        "plugin:react/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
        "plugin:prettier/recommended",
        "plugin:react-hooks/recommended",
    ],
    plugins: [
        "prettier",
        "react-hooks",
        "@typescript-eslint",
        "import",
        "react",
    ],
    rules: {
        "prettier/prettier": ["error", {}, { usePrettierrc: true }],
        quotes: ["error", "double"],
        "react/react-in-jsx-scope": "off",
        "no-unused-vars": "off",
        "react/jsx-props-no-spreading": "off",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            { argsIgnorePattern: "^_" },
        ],
        "import/no-extraneous-dependencies": [
            "error",
            {
                devDependencies: ["**/*.config.ts", "**/*.config.js"],
            },
        ],
        "no-nested-ternary": "off",
        "react/no-unstable-nested-components": "off",
    },
};
