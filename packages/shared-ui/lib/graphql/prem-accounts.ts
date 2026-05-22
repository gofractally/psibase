import { graphql } from "@shared/lib/graphql";
import { premAccounts } from "@shared/lib/plugins";
import { zCurrentPricesData } from "@shared/lib/schemas/prem-accounts";

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
