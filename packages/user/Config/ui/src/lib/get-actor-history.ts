import z from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { stagedTx } from "@shared/lib/plugins";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

const HistoryItem = z.object({
    actor: zAccount,
    txid: z.string(),
    eventType: z.enum([
        "proposed",
        "accepted",
        "deleted",
        "executed",
        "deleted",
        "rejected",
    ]),
    datetime: zDateTime,
});

const response = z.object({
    actorHistory: z.object({
        nodes: HistoryItem.array(),
    }),
});

export const getActorHistory = async (account: Account) => {
    const res = await callGraphqlViaPlugin(
        stagedTx.authorized.graphql,
        `{ 
            actorHistory(actor: "${account}", last: 8) {
                nodes {
                    actor
                    txid
                    eventType
                    datetime
                }
            }
        }`,
    );

    return response.parse(res).actorHistory.nodes;
};
