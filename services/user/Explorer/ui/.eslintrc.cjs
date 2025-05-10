module.exports = {
  "extends": [
    "eslint:recommended",
    "plugin:prettier/recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  parserOptions: {
    ecmaVersion: 2019,
    sourceType: "module",
  },
  plugins: ["prettier", "svelte3", "@typescript-eslint"],
  overrides: [
    {
      files: ["*.svelte"],
      processor: "svelte3/svelte3",
    }
  ],
  env: {
    es6: true,
    browser: true
  },
  rules: {
    quotes: ["error", "double"],
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_" },
    ],
    "no-nested-ternary": "off",
  },
};
