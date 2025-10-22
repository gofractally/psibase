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
            config: {
                apolloReactHooksImportFrom: "@apollo/client/react",
                withHooks: true,
            },
        },
    },
    // emitLegacyCommonJSImports: true,
    overwrite: true,
};

export default config;
