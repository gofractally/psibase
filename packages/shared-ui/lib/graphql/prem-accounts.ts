import { graphql } from "@shared/lib/graphql";
import { premAccounts } from "@shared/lib/plugins";
import {
    buildPremiumMarketOverviewRows,
    zCurrentPricesData,
    zPremiumMarketsOverviewData,
    type PremiumMarketOverviewRow,
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
        { service: premAccounts.service },
    );

    const { currentPrices } = zCurrentPricesData.parse(raw);
    return new Map(currentPrices.map((row) => [row.length, row.price]));
}

export const fetchCurrentPriceForLength = async (length: number) => {
    const currentPrices = await fetchCurrentPrices();
    return currentPrices.get(length);
};

export async function fetchPremiumMarketsOverview(): Promise<
    PremiumMarketOverviewRow[]
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
        { service: premAccounts.service },
    );

    const { marketParams, currentPrices } =
        zPremiumMarketsOverviewData.parse(raw);
    return buildPremiumMarketOverviewRows(marketParams, currentPrices);
}
