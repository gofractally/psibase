import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { stagedTx } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

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
            const res = await authorizedPluginGraphql(
                stagedTx.authorized.graphql,
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
            );

            return zResponse.parse(res).txidHistory.nodes.reverse();
        },
    });
