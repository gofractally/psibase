import rootConfig from "../../../eslint.config.mjs";

export default [
    { ignores: ["e2e/**"] },
    ...rootConfig,
];
