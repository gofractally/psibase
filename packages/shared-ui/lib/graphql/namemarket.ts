import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { nameMarket } from "@shared/lib/plugins";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
    zAccountMarketsOverviewData,
    zCurrentPricesData,
} from "@shared/lib/schemas/account-markets";

export async function fetchCurrentPrices() {
    const raw = await callGraphqlViaPlugin(
        nameMarket.authorized.graphql,
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

export const fetchCurrentPriceForLength = async (length: number) => {
    const currentPrices = await fetchCurrentPrices();
    return currentPrices.get(length);
};

export async function fetchAccountMarketsOverview(): Promise<
    AccountMarketOverviewRow[]
> {
    const raw = await callGraphqlViaPlugin(
        nameMarket.authorized.graphql,
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
