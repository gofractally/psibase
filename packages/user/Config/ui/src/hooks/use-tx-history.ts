import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

const zResponse = z.object({
    txidHistory: z.object({
        nodes: z
            .object({
                actor: zAccount,
                datetime: z.string(),
                eventType: z.enum([
                    "proposed",
                    "accepted",
                    "deleted",
                    "executed",
                    "deleted",
                    "rejected",
                ]),
            })
            .array(),
    }),
});

export const useTxHistory = (txId: string | undefined | null) =>
    useQuery({
        enabled: !!txId,
        queryKey: QueryKey.transactionHistory(txId),
        queryFn: async () => {
            const res = await graphql(
                `
                {
                    txidHistory(
                        txid: "${txId}"
                    ) {
                        nodes {
                            actor
                            datetime
                            eventType
                        }
                    }
                }
            `,
                siblingUrl(null, "staged-tx", "/graphql"),
            );

            return zResponse.parse(res).txidHistory.nodes.reverse();
        },
    });
