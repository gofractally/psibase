/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n    query GetFractalGuil($fractal: AccountNumber!) {\n        fractal(fractal: $fractal) {\n            account\n            createdAt\n            mission\n            name\n        }\n        guilds(fractal: $fractal) {\n            nodes {\n                account\n                rep {\n                    member\n                }\n                displayName\n                bio\n                evalInstance {\n                    evaluationId\n                }\n            }\n        }\n    }\n": typeof types.GetFractalGuilDocument,
    "\n    query GetFractal($fractalAccount: AccountNumber!) {\n  fractal(fractal: $fractalAccount) {\n    account\n    createdAt\n  }\n}\n    ": typeof types.GetFractalDocument,
    "\n    query GetFractalGuild($fractal: AccountNumber!) {\n  fractal(fractal: $fractal) {\n    account\n    createdAt\n    mission\n    name\n  }\n  guilds(fractal: $fractal) {\n    nodes {\n      account\n      rep {\n        member\n      }\n      displayName\n      council\n      bio\n      evalInstance {\n        evaluationId\n      }\n    }\n  }\n}\n    ": typeof types.GetFractalGuildDocument,
    "\n    query GetFractals {\n  fractals {\n    nodes {\n      account\n      name\n      mission\n    }\n  }\n}\n    ": typeof types.GetFractalsDocument,
};
const documents: Documents = {
    "\n    query GetFractalGuil($fractal: AccountNumber!) {\n        fractal(fractal: $fractal) {\n            account\n            createdAt\n            mission\n            name\n        }\n        guilds(fractal: $fractal) {\n            nodes {\n                account\n                rep {\n                    member\n                }\n                displayName\n                bio\n                evalInstance {\n                    evaluationId\n                }\n            }\n        }\n    }\n": types.GetFractalGuilDocument,
    "\n    query GetFractal($fractalAccount: AccountNumber!) {\n  fractal(fractal: $fractalAccount) {\n    account\n    createdAt\n  }\n}\n    ": types.GetFractalDocument,
    "\n    query GetFractalGuild($fractal: AccountNumber!) {\n  fractal(fractal: $fractal) {\n    account\n    createdAt\n    mission\n    name\n  }\n  guilds(fractal: $fractal) {\n    nodes {\n      account\n      rep {\n        member\n      }\n      displayName\n      council\n      bio\n      evalInstance {\n        evaluationId\n      }\n    }\n  }\n}\n    ": types.GetFractalGuildDocument,
    "\n    query GetFractals {\n  fractals {\n    nodes {\n      account\n      name\n      mission\n    }\n  }\n}\n    ": types.GetFractalsDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetFractalGuil($fractal: AccountNumber!) {\n        fractal(fractal: $fractal) {\n            account\n            createdAt\n            mission\n            name\n        }\n        guilds(fractal: $fractal) {\n            nodes {\n                account\n                rep {\n                    member\n                }\n                displayName\n                bio\n                evalInstance {\n                    evaluationId\n                }\n            }\n        }\n    }\n"): (typeof documents)["\n    query GetFractalGuil($fractal: AccountNumber!) {\n        fractal(fractal: $fractal) {\n            account\n            createdAt\n            mission\n            name\n        }\n        guilds(fractal: $fractal) {\n            nodes {\n                account\n                rep {\n                    member\n                }\n                displayName\n                bio\n                evalInstance {\n                    evaluationId\n                }\n            }\n        }\n    }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetFractal($fractalAccount: AccountNumber!) {\n  fractal(fractal: $fractalAccount) {\n    account\n    createdAt\n  }\n}\n    "): (typeof documents)["\n    query GetFractal($fractalAccount: AccountNumber!) {\n  fractal(fractal: $fractalAccount) {\n    account\n    createdAt\n  }\n}\n    "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetFractalGuild($fractal: AccountNumber!) {\n  fractal(fractal: $fractal) {\n    account\n    createdAt\n    mission\n    name\n  }\n  guilds(fractal: $fractal) {\n    nodes {\n      account\n      rep {\n        member\n      }\n      displayName\n      council\n      bio\n      evalInstance {\n        evaluationId\n      }\n    }\n  }\n}\n    "): (typeof documents)["\n    query GetFractalGuild($fractal: AccountNumber!) {\n  fractal(fractal: $fractal) {\n    account\n    createdAt\n    mission\n    name\n  }\n  guilds(fractal: $fractal) {\n    nodes {\n      account\n      rep {\n        member\n      }\n      displayName\n      council\n      bio\n      evalInstance {\n        evaluationId\n      }\n    }\n  }\n}\n    "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetFractals {\n  fractals {\n    nodes {\n      account\n      name\n      mission\n    }\n  }\n}\n    "): (typeof documents)["\n    query GetFractals {\n  fractals {\n    nodes {\n      account\n      name\n      mission\n    }\n  }\n}\n    "];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;