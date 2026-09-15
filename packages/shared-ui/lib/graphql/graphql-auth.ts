import {
    type PluginCall,
    callPluginFunction,
} from "@shared/lib/plugins/lib/call-plugin-function";

/** A plugin function that accepts a GraphQL query and returns the raw JSON response. */
export type GraphqlPluginCall = PluginCall<[query: string], string>;

type GraphqlResponse<T> = {
    data: T;
    errors?: Array<{ message: string }>;
};

/**
 * Runs an authenticated GraphQL query.
 *
 * Front ends cannot query another service's `/graphql` endpoint directly: the
 * default Content Security Policy only allows `connect-src 'self'`, and a
 * direct request would carry no session credentials anyway. Instead, the query
 * is routed through the app's own plugin (`call`), which attaches the current
 * user's query token for the target service and forwards the request.
 *
 * Use this instead of `postGraphQLGetJson` whenever the query targets a
 * service other than the current app, or when the query requires the
 * logged-in user's identity.
 *
 * Resolves to the `data` field of the response; throws on GraphQL errors.
 */
export async function graphqlAuth<T>(
    call: GraphqlPluginCall,
    query: string,
): Promise<T> {
    const result = await callPluginFunction(call, [query]);
    const response = JSON.parse(result) as GraphqlResponse<T>;
    if (response.errors?.length) {
        throw new Error(
            response.errors[0]?.message ?? "GraphQL query failed",
        );
    }
    return response.data;
}
