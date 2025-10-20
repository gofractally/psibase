import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
    schema: "./src/lib/graphql/schema.graphql",
    documents: ["src/lib/graphql/**/*.graphql"],
    generates: {
        "./src/lib/graphql/generated.ts": {
            plugins: [
                "typescript",
                "typescript-operations",
                "typescript-react-apollo",
            ],
        },
    },
    overwrite: true,
};

export default config;
