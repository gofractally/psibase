import { z } from "zod";

export const zTokenGraphqlRow = z.object({
    precision: z.number().int().min(0),
    symbol: z.string().nullish(),
});

export const zTokenQueryData = z.object({
    token: zTokenGraphqlRow.nullable(),
});

export const zNameEventNode = z.object({
    account: z.string(),
    action: z.string(),
    block: z
        .object({
            blockTime: z.string().nullish(),
        })
        .nullish()
        .optional(),
});

export const zNameEvent = z.object({
    account: z.string(),
    action: z.string(),
    blockTime: z.string().optional(),
});

export const zNameEventsPageData = z.object({
    nameEvents: z
        .object({
            edges: z
                .array(
                    z.object({
                        cursor: z.string().optional(),
                        node: zNameEventNode.nullable().optional(),
                    }),
                )
                .nullish()
                .transform((e) => e ?? []),
            pageInfo: z
                .object({
                    hasNextPage: z.boolean().optional(),
                    hasPreviousPage: z.boolean().optional(),
                    endCursor: z.string().nullish().optional(),
                })
                .optional(),
        })
        .nullable()
        .optional(),
});

export const zNameEventsPage = z.object({
    events: z.array(zNameEvent),
    pageInfo: z.object({
        hasNextPage: z.boolean(),
        hasPreviousPage: z.boolean(),
        endCursor: z.string().nullish().optional(),
        /** Cursor of the oldest event in the page; use as `before` for the next older page. */
        oldestCursor: z.string().nullish().optional(),
    }),
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
export type NameEventsPage = z.infer<typeof zNameEventsPage>;
