import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
    zAccountMarketsOverviewData,
    zCurrentPricesData,
} from "@shared/lib/schemas/account-markets";

export type GraphqlPluginCall = PluginCall<[query: string], string>;

export async function fetchCurrentPrices(graphql: GraphqlPluginCall) {
    const raw = await callGraphqlViaPlugin(
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
    const raw = await callGraphqlViaPlugin(
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
