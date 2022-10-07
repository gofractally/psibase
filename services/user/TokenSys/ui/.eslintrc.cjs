module.exports = {
    "root": true,
    "parser": "@typescript-eslint/parser",
    parserOptions: {
        "sourceType": "module",
        "ecmaVersion": 2020,
    },
    extends: ["plugin:prettier/recommended"],
    plugins: ["prettier", "@typescript-eslint"],
    rules: {
        quotes: ["error", "double"],
        "react/react-in-jsx-scope": "off",
        "no-unused-vars": "off",
        "react/jsx-props-no-spreading": "off",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            { argsIgnorePattern: "^_" },
        ],
        "no-nested-ternary": "off",
        "react/no-unstable-nested-components": "off",
    },
};