module.exports = {
  extends: ["plugin:prettier/recommended"],
  plugins: ["prettier"],
  rules: {
    quotes: ["error", "double"],
    "react/react-in-jsx-scope": "off",
    "no-unused-vars": "off",
    "react/jsx-props-no-spreading": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
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
