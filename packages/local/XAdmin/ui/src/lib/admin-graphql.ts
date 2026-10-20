import {
    graphql,
    type GraphQLUrlOptions,
} from "@shared/lib/graphql";

import { adminBearerAuthHeaders } from "./admin-login-jwt";

export async function adminGraphql<T>(
    query: string,
    options: Omit<GraphQLUrlOptions, "headers"> = {},
): Promise<T> {
    return graphql<T>(query, {
        ...options,
        headers: await adminBearerAuthHeaders(),
    });
}
