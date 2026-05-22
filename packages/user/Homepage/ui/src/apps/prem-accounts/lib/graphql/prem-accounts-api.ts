import { pluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { premAccounts } from "@shared/lib/plugins";

import {
    zNameEvent,
    zNameEventsPageData,
    zUnclaimedNamesPageData,
} from "./prem-accounts.schemas";

const FETCH_BATCH_SIZE = 50;

async function premAccountsAuthorizedGraphql<T>(query: string): Promise<T> {
    const result = await pluginFunctionQuery(premAccounts.authorized.graphql, [
        query,
    ]);

    const response = JSON.parse(result) as {
        data: T;
        errors?: Array<{ message: string }>;
    };

    if (response.errors?.length) {
        throw new Error(response.errors[0]?.message ?? "GraphQL query failed");
    }

    return response.data;
}

export async function fetchAllUnclaimedNames() {
    const allNames: string[] = [];
    let hasNextPage = true;
    let cursorArg = "";

    while (hasNextPage) {
        const page = zUnclaimedNamesPageData.parse(
            await premAccountsAuthorizedGraphql(
                `
                    {
                        unclaimedNames(first: ${FETCH_BATCH_SIZE}${cursorArg}) {
                            edges {
                                node {
                                    account
                                }
                            }
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                        }
                    }
                `,
            ),
        );

        const connection = page.unclaimedNames;
        if (!connection) {
            break;
        }

        for (const edge of connection.edges) {
            if (edge.node) {
                allNames.push(edge.node.account);
            }
        }

        hasNextPage = connection.pageInfo?.hasNextPage ?? false;
        const endCursor = connection.pageInfo?.endCursor;
        cursorArg = endCursor ? `, after: "${endCursor}"` : "";
    }

    return allNames;
}

export async function fetchAllNameEvents(owner: string) {
    const allEvents: Array<{ account: string; action: string }> = [];
    let hasNextPage = true;
    let cursorArg = "";

    while (hasNextPage) {
        const page = zNameEventsPageData.parse(
            await premAccountsAuthorizedGraphql(
                `
                    {
                        nameEvents(owner: "${owner}", first: ${FETCH_BATCH_SIZE}${cursorArg}) {
                            edges {
                                node {
                                    account
                                    action
                                }
                            }
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                        }
                    }
                `,
            ),
        );

        const connection = page.nameEvents;
        if (!connection) {
            break;
        }

        for (const edge of connection.edges) {
            if (edge.node) {
                allEvents.push(zNameEvent.parse(edge.node));
            }
        }

        hasNextPage = connection.pageInfo?.hasNextPage ?? false;
        const endCursor = connection.pageInfo?.endCursor;
        cursorArg = endCursor ? `, after: "${endCursor}"` : "";
    }

    return allEvents;
}
