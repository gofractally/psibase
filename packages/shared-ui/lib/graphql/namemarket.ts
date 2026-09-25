import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
    zAccountMarketsOverviewData,
    zCurrentPricesData,
} from "@shared/lib/schemas/account-markets";

export type GraphqlPluginCall = PluginCall<[query: string], string>;

export async function fetchCurrentPrices(graphqlCall: GraphqlPluginCall) {
    const raw = await callGraphqlViaPlugin(
        graphqlCall,
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
    graphqlCall: GraphqlPluginCall,
    length: number,
) => {
    const currentPrices = await fetchCurrentPrices(graphqlCall);
    return currentPrices.get(length);
};

export async function fetchAccountMarketsOverview(
    graphqlCall: GraphqlPluginCall,
): Promise<AccountMarketOverviewRow[]> {
    const raw = await callGraphqlViaPlugin(
        graphqlCall,
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
