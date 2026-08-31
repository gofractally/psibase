import {
    type PluginCall,
    callPluginFunction,
} from "@shared/lib/plugins/lib/call-plugin-function";

type AuthorizedGraphqlResponse<T> = {
    data: T;
    errors?: Array<{ message: string }>;
};

export async function authorizedPluginGraphql<T>(
    call: PluginCall<[query: string], string>,
    query: string,
): Promise<T> {
    const result = await callPluginFunction(call, [query]);
    const response = JSON.parse(result) as AuthorizedGraphqlResponse<T>;
    if (response.errors?.length) {
        throw new Error(
            response.errors[0]?.message ?? "GraphQL query failed",
        );
    }
    return response.data;
}
