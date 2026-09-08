import { siblingUrl } from "@psibase/common-lib";

interface GraphQLError {
    message: string;
}

interface GraphQLResponse<T> {
    data?: T;
    errors?: GraphQLError[] | GraphQLError;
}

const extractError = (body: unknown): string | null => {
    if (typeof body !== "object" || body === null) return null;
    const { errors } = body as GraphQLResponse<unknown>;
    if (!errors) return null;
    if (Array.isArray(errors)) return errors[0]?.message ?? "GraphQL error";
    return errors.message ?? "GraphQL error";
};

/**
 * POST a GraphQL query. With no `service` the request goes to the explorer
 * service itself (same origin); otherwise it targets a sibling service on
 * the same root domain.
 */
export const graphql = async <T>(
    query: string,
    service?: string,
    signal?: AbortSignal,
): Promise<T> => {
    const url = service ? siblingUrl(null, service, "/graphql") : "/graphql";
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal,
    });
    const text = await res.text();
    let body: GraphQLResponse<T> | null = null;
    try {
        body = text ? (JSON.parse(text) as GraphQLResponse<T>) : null;
    } catch {
        throw new Error(
            res.ok ? "Invalid JSON response" : `HTTP ${res.status}`,
        );
    }
    const err = extractError(body);
    if (err) throw new Error(err);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!body?.data) throw new Error("Empty response");
    return body.data;
};

export const gqlString = (value: string) => JSON.stringify(value);
