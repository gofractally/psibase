import rootConfig from "../../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    files: ["src/lib/graphql/generated.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];