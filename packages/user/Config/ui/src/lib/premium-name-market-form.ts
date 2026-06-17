import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";
import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import type { MarketConfigInput } from "@shared/lib/plugins/config";

import { z } from "zod";

import {
    PREMIUM_MARKET_DEFAULT_PARAMS,
    PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
} from "@/lib/premium-name-market-defaults";
import {
    parsePercentToPct,
    parsePositiveInt,
    parseSystemTokenAmount,
    ppmToWholePercentString,
} from "@/lib/premium-name-market-parsers";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

export type PremiumNameMarketFormRow = {
    length: number;
    configured: boolean;
    enabled: boolean;
    initialPrice: string;
    floorPrice: string;
    target: string;
    increasePpm: string;
    decreasePpm: string;
};

export type PremiumNameMarketsFormValues = {
    markets: PremiumNameMarketFormRow[];
};

export type MarketConfigParam = MarketConfigInput;

const zDirtyMarketRow = (systemToken: SystemTokenInfo) =>
    z
        .object({
            length: z.number(),
            configured: z.boolean(),
            enabled: z.boolean(),
            initialPrice: z.string(),
            floorPrice: z.string(),
            target: z.string(),
            increasePpm: z.string(),
            decreasePpm: z.string(),
        })
        .superRefine((row, ctx) => {
            if (!row.configured && row.initialPrice.trim() === "") {
                ctx.addIssue({
                    code: "custom",
                    message: "Initial price is required",
                    path: ["initialPrice"],
                });
            } else if (
                !row.configured &&
                parseSystemTokenAmount(row.initialPrice, systemToken) === null
            ) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a valid token amount",
                    path: ["initialPrice"],
                });
            }

            if (row.floorPrice.trim() === "") {
                ctx.addIssue({
                    code: "custom",
                    message: "Floor price is required",
                    path: ["floorPrice"],
                });
            } else if (
                parseSystemTokenAmount(row.floorPrice, systemToken) === null
            ) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a valid token amount",
                    path: ["floorPrice"],
                });
            }

            if (parsePositiveInt(row.target) === null) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a positive integer",
                    path: ["target"],
                });
            }

            if (parsePercentToPct(row.increasePpm) === null) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a whole-number percent from 1 to 255",
                    path: ["increasePpm"],
                });
            }

            if (parsePercentToPct(row.decreasePpm) === null) {
                ctx.addIssue({
                    code: "custom",
                    message: "Enter a whole-number percent from 1 to 255",
                    path: ["decreasePpm"],
                });
            }
        });

export function buildPremiumNameMarketsFormValues(
    configuredRows: ConfiguredPremiumNameMarketRow[] | undefined,
): PremiumNameMarketsFormValues {
    const byLength = new Map(
        configuredRows?.map((row) => [row.length, row]) ?? [],
    );
    const markets: PremiumNameMarketFormRow[] = [];

    for (
        let length = MIN_ACCOUNT_NAME_LENGTH;
        length <= MAX_ACCOUNT_NAME_LENGTH;
        length++
    ) {
        const row = byLength.get(length);
        markets.push({
            length,
            configured: row !== undefined,
            enabled: row?.enabled ?? false,
            initialPrice: PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
            floorPrice:
                row?.floorPrice ?? PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice,
            target: String(row?.target ?? PREMIUM_MARKET_DEFAULT_PARAMS.target),
            increasePpm: row
                ? ppmToWholePercentString(row.increasePpm)
                : PREMIUM_MARKET_DEFAULT_PARAMS.increasePercent,
            decreasePpm: row
                ? ppmToWholePercentString(row.decreasePpm)
                : PREMIUM_MARKET_DEFAULT_PARAMS.decreasePercent,
        });
    }

    return { markets };
}

export function marketRowsEqual(
    a: PremiumNameMarketFormRow,
    b: PremiumNameMarketFormRow,
): boolean {
    return (
        a.enabled === b.enabled &&
        a.initialPrice === b.initialPrice &&
        a.floorPrice === b.floorPrice &&
        a.target === b.target &&
        a.increasePpm === b.increasePpm &&
        a.decreasePpm === b.decreasePpm
    );
}

export function getDirtyMarkets(
    values: PremiumNameMarketsFormValues,
    defaults: PremiumNameMarketsFormValues,
): PremiumNameMarketFormRow[] {
    return values.markets.filter(
        (row, index) => !marketRowsEqual(row, defaults.markets[index]!),
    );
}

export function validateDirtyMarkets(
    values: PremiumNameMarketsFormValues,
    defaults: PremiumNameMarketsFormValues,
    systemToken: SystemTokenInfo,
): { fields: Record<string, string> } | undefined {
    const fieldErrors: Record<string, string> = {};

    values.markets.forEach((row, index) => {
        if (marketRowsEqual(row, defaults.markets[index]!)) {
            return;
        }

        const result = zDirtyMarketRow(systemToken).safeParse(row);
        if (result.success) {
            return;
        }

        for (const issue of result.error.issues) {
            const field = issue.path[0];
            if (typeof field !== "string") {
                continue;
            }
            fieldErrors[`markets[${index}].${field}`] = issue.message;
        }
    });

    if (Object.keys(fieldErrors).length === 0) {
        return undefined;
    }

    return { fields: fieldErrors };
}

export function toMarketConfig(
    row: PremiumNameMarketFormRow,
    systemToken: SystemTokenInfo,
): MarketConfigParam {
    const target = parsePositiveInt(row.target);
    const increasePct = parsePercentToPct(row.increasePpm);
    const decreasePct = parsePercentToPct(row.decreasePpm);
    const floorPrice = parseSystemTokenAmount(row.floorPrice, systemToken);

    if (
        target === null ||
        increasePct === null ||
        decreasePct === null ||
        floorPrice === null
    ) {
        throw new Error(`Invalid market config for length ${row.length}`);
    }

    const initialPrice = row.configured
        ? null
        : parseSystemTokenAmount(row.initialPrice, systemToken);

    if (!row.configured && initialPrice === null) {
        throw new Error(`Invalid initial price for length ${row.length}`);
    }

    return {
        length: row.length,
        windowSeconds: PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
        target,
        floorPrice,
        increasePct,
        decreasePct,
        enabled: row.enabled,
        initialPrice,
    };
}
