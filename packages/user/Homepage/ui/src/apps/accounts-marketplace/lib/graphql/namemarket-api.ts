import { callPluginFunction, nameMarket } from "@shared/lib/plugins";

import {
    zNameEvent,
    zNameEventNode,
    zNameEventsPage,
    zNameEventsPageData,
    zUnclaimedNamesPageData,
} from "./namemarket.schemas";

const FETCH_BATCH_SIZE = 50;

export const NAME_EVENTS_EXISTENCE_PAGE_SIZE = 1;
export const NAME_EVENTS_HISTORY_PAGE_SIZE = 10;

export type FetchNameEventsPageParams =
    | { first: number; after?: string }
    | { last: number; before?: string };

async function nameMarketAuthorizedGraphql<T>(query: string): Promise<T> {
    const result = await callPluginFunction(nameMarket.authorized.graphql, [
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

function mapNameEventEdges(edges: Array<{ cursor?: string; node?: unknown }>) {
    return edges
        .filter((edge) => edge.node)
        .map((edge) => {
            const node = zNameEventNode.parse(edge.node);
            return {
                event: zNameEvent.parse({
                    account: node.account,
                    action: node.action,
                    blockTime: node.block?.blockTime ?? undefined,
                }),
                cursor: edge.cursor,
            };
        });
}

export async function fetchAllUnclaimedNames() {
    const allNames: string[] = [];
    let hasNextPage = true;
    let cursorArg = "";

    while (hasNextPage) {
        const page = zUnclaimedNamesPageData.parse(
            await nameMarketAuthorizedGraphql(
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

const NAME_EVENT_NODE_FIELDS = `
    account
    action
    block {
        blockTime
    }
`;

export async function fetchNameEventsPage(
    owner: string,
    params: FetchNameEventsPageParams,
) {
    const isBackward = "last" in params;
    const paginationArg = isBackward
        ? `last: ${params.last}${
              params.before ? `, before: "${params.before}"` : ""
          }`
        : `first: ${params.first}${
              params.after ? `, after: "${params.after}"` : ""
          }`;

    const page = zNameEventsPageData.parse(
        await nameMarketAuthorizedGraphql(
            `
                {
                    nameEvents(owner: "${owner}", ${paginationArg}) {
                        edges {
                            cursor
                            node {
                                ${NAME_EVENT_NODE_FIELDS}
                            }
                        }
                        pageInfo {
                            hasNextPage
                            hasPreviousPage
                            endCursor
                        }
                    }
                }
            `,
        ),
    );

    const connection = page.nameEvents;
    if (!connection) {
        return zNameEventsPage.parse({
            events: [],
            pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
            },
        });
    }

    const mapped = mapNameEventEdges(connection.edges);
    const events = mapped.map((item) => item.event);

    if (isBackward) {
        events.reverse();
    }

    const oldestCursor = mapped[0]?.cursor;

    return zNameEventsPage.parse({
        events,
        pageInfo: {
            hasNextPage: connection.pageInfo?.hasNextPage ?? false,
            hasPreviousPage: connection.pageInfo?.hasPreviousPage ?? false,
            endCursor: connection.pageInfo?.endCursor,
            oldestCursor,
        },
    });
}
