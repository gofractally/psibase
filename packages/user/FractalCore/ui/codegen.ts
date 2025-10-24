import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
    schema: "./src/lib/graphql/schema.graphql",
    documents: ["src/**/*.tsx", "src/**/*.ts"],
    ignoreNoDocuments: true, // for better experience with the watcher
    generates: {
        "./src/gql/": {
            preset: "client",
        },
    },
};

export default config;
