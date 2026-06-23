import { z } from "zod";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

export const zCurrentPriceRow = z.object({
    length: z
        .number()
        .int()
        .min(MIN_ACCOUNT_NAME_LENGTH)
        .max(MAX_ACCOUNT_NAME_LENGTH),
    price: z.string(),
});

export const zCurrentPricesData = z.object({
    currentPrices: z
        .array(zCurrentPriceRow)
        .nullable()
        .transform((rows) => rows ?? []),
});

export const zMarketParamRow = z.object({
    length: z
        .number()
        .int()
        .min(MIN_ACCOUNT_NAME_LENGTH)
        .max(MAX_ACCOUNT_NAME_LENGTH),
    enabled: z.boolean(),
});

export const zAccountMarketsOverviewData = z.object({
    marketParams: z
        .array(zMarketParamRow)
        .nullable()
        .transform((rows) => rows ?? []),
    currentPrices: z
        .array(zCurrentPriceRow)
        .nullable()
        .transform((rows) => rows ?? []),
});

export type AccountMarketOverviewRow = {
    length: number;
    /** Whether a market exists for this name length. */
    configured: boolean;
    enabled: boolean;
    /** Current market price when enabled; otherwise null. */
    price: string | null;
};

export function buildAccountMarketOverviewRows(
    marketParams: z.infer<typeof zMarketParamRow>[],
    currentPrices: z.infer<typeof zCurrentPriceRow>[],
): AccountMarketOverviewRow[] {
    const paramsByLength = new Map(
        marketParams.map((row) => [row.length, row]),
    );
    const pricesByLength = new Map(
        currentPrices.map((row) => [row.length, row.price]),
    );

    const rows: AccountMarketOverviewRow[] = [];
    for (
        let length = MIN_ACCOUNT_NAME_LENGTH;
        length <= MAX_ACCOUNT_NAME_LENGTH;
        length++
    ) {
        const param = paramsByLength.get(length);
        rows.push({
            length,
            configured: param !== undefined,
            enabled: param?.enabled ?? false,
            price: pricesByLength.get(length) ?? null,
        });
    }
    return rows;
}

/** Sparse map of name length → current ask (enabled markets only). */
export function accountMarketPricesFromOverview(
    markets: AccountMarketOverviewRow[],
): Map<number, string> {
    const prices = new Map<number, string>();
    for (const row of markets) {
        if (row.price !== null) {
            prices.set(row.length, row.price);
        }
    }
    return prices;
}

export function hasActiveAccountMarket(
    markets: AccountMarketOverviewRow[] | undefined,
): boolean {
    return markets?.some((row) => row.price !== null) ?? false;
}
