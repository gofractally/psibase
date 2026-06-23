import type { ConfiguredNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";
import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import type { MarketConfigInput } from "@shared/lib/plugins/config";

import { z } from "zod";

import { NAME_MARKET_DEFAULT_PARAMS } from "@/lib/premium-name-market-defaults";
import {
    parsePercentToPct,
    parsePositiveInt,
    parseSystemTokenAmount,
    parseWindowSeconds,
    ppmToWholePercentString,
    secondsToWindowForm,
} from "@/lib/premium-name-market-parsers";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";
import { zDurationUnit } from "@shared/lib/schemas/duration-unit";

export type NameMarketFormRow = {
    length: number;
    configured: boolean;
    enabled: boolean;
    initialPrice: string;
    floorPrice: string;
    windowAmount: string;
    windowUnit: z.infer<typeof zDurationUnit>;
    target: string;
    increasePpm: string;
    decreasePpm: string;
};

export type NameMarketsFormValues = {
    markets: NameMarketFormRow[];
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
            windowAmount: z.string(),
            windowUnit: zDurationUnit,
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

            if (parseWindowSeconds(row.windowAmount, row.windowUnit) === null) {
                ctx.addIssue({
                    code: "custom",
                    message: "Window length is required",
                    path: ["windowAmount"],
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

export function buildNameMarketsFormValues(
    configuredRows: ConfiguredNameMarketRow[] | undefined,
): NameMarketsFormValues {
    const byLength = new Map(
        configuredRows?.map((row) => [row.length, row]) ?? [],
    );
    const markets: NameMarketFormRow[] = [];

    for (
        let length = MIN_ACCOUNT_NAME_LENGTH;
        length <= MAX_ACCOUNT_NAME_LENGTH;
        length++
    ) {
        const row = byLength.get(length);
        const configured = row !== undefined;
        const windowForm = configured
            ? secondsToWindowForm(row!.windowSeconds)
            : {
                  amount: "",
                  unit: NAME_MARKET_DEFAULT_PARAMS.windowUnit,
              };
        markets.push({
            length,
            configured,
            enabled: row?.enabled ?? false,
            initialPrice: configured ? row!.initialPrice : "",
            floorPrice: row?.floorPrice ?? "",
            windowAmount: windowForm.amount,
            windowUnit: windowForm.unit,
            target: configured ? String(row!.target) : "",
            increasePpm: configured
                ? ppmToWholePercentString(row!.increasePpm)
                : "",
            decreasePpm: configured
                ? ppmToWholePercentString(row!.decreasePpm)
                : "",
        });
    }

    return { markets };
}

export function marketRowsEqual(
    a: NameMarketFormRow,
    b: NameMarketFormRow,
): boolean {
    return (
        a.enabled === b.enabled &&
        a.initialPrice === b.initialPrice &&
        a.floorPrice === b.floorPrice &&
        a.windowAmount === b.windowAmount &&
        a.windowUnit === b.windowUnit &&
        a.target === b.target &&
        a.increasePpm === b.increasePpm &&
        a.decreasePpm === b.decreasePpm
    );
}

export function getDirtyMarkets(
    values: NameMarketsFormValues,
    defaults: NameMarketsFormValues,
): NameMarketFormRow[] {
    return values.markets.filter(
        (row, index) => !marketRowsEqual(row, defaults.markets[index]!),
    );
}

export function validateDirtyMarkets(
    values: NameMarketsFormValues,
    defaults: NameMarketsFormValues,
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
    row: NameMarketFormRow,
    systemToken: SystemTokenInfo,
): MarketConfigParam {
    const target = parsePositiveInt(row.target);
    const increasePct = parsePercentToPct(row.increasePpm);
    const decreasePct = parsePercentToPct(row.decreasePpm);
    const floorPrice = parseSystemTokenAmount(row.floorPrice, systemToken);
    const windowSeconds = parseWindowSeconds(row.windowAmount, row.windowUnit);

    if (
        target === null ||
        increasePct === null ||
        decreasePct === null ||
        floorPrice === null ||
        windowSeconds === null
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
        windowSeconds,
        target,
        floorPrice,
        increasePct,
        decreasePct,
        enabled: row.enabled,
        initialPrice,
    };
}
