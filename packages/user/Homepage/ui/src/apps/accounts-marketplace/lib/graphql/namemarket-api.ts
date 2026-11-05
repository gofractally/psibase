import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { homepage } from "@shared/lib/plugins";

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
    return graphqlAuth(homepage.accountsMarketplace.graphql, query);
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

const PURCHASED_NAMES_FIELDS = `
    edges {
        node {
            account
        }
    }
    pageInfo {
        hasNextPage
        endCursor
    }
`;

function accountNames(
    connection: {
        edges: Array<{ node?: { account: string } | null }>;
    } | null | undefined,
) {
    return (connection?.edges ?? [])
        .map((edge) => edge.node?.account)
        .filter((account): account is string => !!account);
}

function nextPage(
    connection: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    } | null | undefined,
) {
    const endCursor = connection?.pageInfo?.endCursor;
    return {
        more: !!connection?.pageInfo?.hasNextPage && !!endCursor,
        after: endCursor ? `, after: "${endCursor}"` : "",
    };
}

export async function fetchAllUnclaimedNames() {
    const allNames: string[] = [];
    let unclaimedAfter = "";
    let debitedAfter = "";
    let unclaimedMore = true;
    let debitedMore = true;

    while (unclaimedMore || debitedMore) {
        const page = zUnclaimedNamesPageData.parse(
            await nameMarketAuthorizedGraphql(
                `
                    {
                        unclaimedNames(first: ${FETCH_BATCH_SIZE}${unclaimedAfter}) {
                            ${PURCHASED_NAMES_FIELDS}
                        }
                        debitedNames(first: ${FETCH_BATCH_SIZE}${debitedAfter}) {
                            ${PURCHASED_NAMES_FIELDS}
                        }
                    }
                `,
            ),
        );

        if (unclaimedMore) {
            allNames.push(...accountNames(page.unclaimedNames));
            const next = nextPage(page.unclaimedNames);
            unclaimedMore = next.more;
            if (next.after) {
                unclaimedAfter = next.after;
            }
        }
        if (debitedMore) {
            allNames.push(...accountNames(page.debitedNames));
            const next = nextPage(page.debitedNames);
            debitedMore = next.more;
            if (next.after) {
                debitedAfter = next.after;
            }
        }
    }

    return [...new Set(allNames)];
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
