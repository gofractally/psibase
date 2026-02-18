import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@shared/lib/schemas/account";
interface GraphQLError {
    message: string;
    locations?: { line: number; column: number }[];
    path?: (string | number)[];
    extensions?: Record<string, unknown>;
}

function extractGraphQLErrorMessage(body: unknown): string | null {
    if (typeof body !== "object" || body === null) return null;
    const obj = body as Record<string, unknown>;
    const errors = obj.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        const first = errors[0];
        if (typeof first === "object" && first !== null) {
            const err = first as GraphQLError;
            if (typeof err.message === "string") return err.message;
            const extMsg = err.extensions as Record<string, unknown> | undefined;
            if (extMsg && typeof extMsg.message === "string")
                return extMsg.message;
        }
    }
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    return null;
}

export type GraphQLUrlOptions = {
    baseUrl?: string | null;
    service?: z.infer<typeof zAccount> | null;
    path?: string | null;
    baseUrlIncludesSibling?: boolean;
};

interface GraphqlResponse<T> {
    data: T;
    errors?: GraphQLError[];
}

export const graphql = async <T>(
    query: string,
    options: GraphQLUrlOptions = {},
): Promise<T> => {
    const { baseUrl, service, path, baseUrlIncludesSibling = true } = options;
    console.info("baseUrlIncludesSibling", baseUrlIncludesSibling);
    console.info("path", path);
    console.info("service", service);
    console.info("baseUrl", baseUrl);
    console.info("siblingUrl():", siblingUrl(baseUrl, service, path, baseUrlIncludesSibling));
    const host = service
        ? siblingUrl(baseUrl, service, path, baseUrlIncludesSibling)
        : "";
    const res = await fetch(`${host}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    let body: unknown;
    try {
        const text = await res.text();
        body = text ? JSON.parse(text) : null;
    } catch {
        if (!res.ok) {
            throw new Error(`Request failed with status ${res.status}`);
        }
        throw new Error("Invalid JSON response");
    }

    const graphqlMessage = extractGraphQLErrorMessage(body);
    if (graphqlMessage) {
        throw new Error(graphqlMessage);
    }

    if (!res.ok) {
        throw new Error(
            typeof body === "object" &&
                body !== null &&
                "message" in body &&
                typeof (body as { message: unknown }).message === "string"
                ? ((body as { message: string }).message)
                : `Request failed with status ${res.status}`,
        );
    }

    const response = body as GraphqlResponse<T>;
    return response.data;
};
