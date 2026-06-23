import { graphql } from "@shared/lib/graphql";
import { nameMarket } from "@shared/lib/plugins";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
    zAccountMarketsOverviewData,
    zCurrentPricesData,
} from "@shared/lib/schemas/prem-accounts";

export async function fetchCurrentPrices() {
    const raw = await graphql(
        `
            query {
                currentPrices {
                    length
                    price
                }
            }
        `,
        { service: nameMarket.service },
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
    const raw = await graphql(
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
        { service: nameMarket.service },
    );

    const { marketParams, currentPrices } =
        zAccountMarketsOverviewData.parse(raw);
    return buildAccountMarketOverviewRows(marketParams, currentPrices);
}
