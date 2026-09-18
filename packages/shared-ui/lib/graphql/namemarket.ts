import {
    type GraphqlPluginCall,
    graphqlAuth,
} from "@shared/lib/graphql/graphql-auth";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
    zAccountMarketsOverviewData,
    zCurrentPricesData,
} from "@shared/lib/schemas/account-markets";

export async function fetchCurrentPrices(graphql: GraphqlPluginCall) {
    const raw = await graphqlAuth(
        graphql,
        `
            query {
                currentPrices {
                    length
                    price
                }
            }
        `,
    );

    const { currentPrices } = zCurrentPricesData.parse(raw);
    return new Map(currentPrices.map((row) => [row.length, row.price]));
}

export const fetchCurrentPriceForLength = async (
    graphql: GraphqlPluginCall,
    length: number,
) => {
    const currentPrices = await fetchCurrentPrices(graphql);
    return currentPrices.get(length);
};

export async function fetchAccountMarketsOverview(
    graphql: GraphqlPluginCall,
): Promise<AccountMarketOverviewRow[]> {
    const raw = await graphqlAuth(
        graphql,
        `
            query {
                marketParams {
                    length
                    enabled
                }
                currentPrices {
                    length
                    price
                }
            }
        `,
    );

    const { marketParams, currentPrices } =
        zAccountMarketsOverviewData.parse(raw);
    return buildAccountMarketOverviewRows(marketParams, currentPrices);
}
