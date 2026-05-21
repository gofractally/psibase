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

export const zTokenGraphqlRow = z.object({
    precision: z.number().int().min(0),
    symbol: z.string().nullish(),
});

export const zTokenQueryData = z.object({
    token: zTokenGraphqlRow.nullable(),
});

const zNameEventNode = z
    .object({
        account: z.string(),
        action: z.string(),
    })
    .passthrough();

export const zNameEvent = z.object({
    account: z.string(),
    action: z.string(),
});

export const zNameEventsPageData = z.object({
    nameEvents: z
        .object({
            edges: z
                .array(
                    z.object({
                        node: zNameEventNode.nullable().optional(),
                    }),
                )
                .nullish()
                .transform((e) => e ?? []),
            pageInfo: z
                .object({
                    hasNextPage: z.boolean().optional(),
                    endCursor: z.string().nullish().optional(),
                })
                .optional(),
        })
        .nullable()
        .optional(),
});

const zUnclaimedNameNode = z
    .object({
        account: z.string(),
    })
    .passthrough();

export const zUnclaimedNamesPageData = z.object({
    unclaimedNames: z
        .object({
            edges: z
                .array(
                    z.object({
                        node: zUnclaimedNameNode.nullable().optional(),
                    }),
                )
                .nullish()
                .transform((e) => e ?? []),
            pageInfo: z
                .object({
                    hasNextPage: z.boolean().optional(),
                    endCursor: z.string().nullish().optional(),
                })
                .optional(),
        })
        .nullable()
        .optional(),
});

export type NameEvent = z.infer<typeof zNameEvent>;
