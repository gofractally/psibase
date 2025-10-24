import z from "zod";

import { derp } from "./graphql";
import { Account, zAccount } from "./zod/Account";
import { zDateTime } from "./zod/DateTime";

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
    const res = await derp(
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
        "staged-tx",
    );

    return response.parse(res).actorHistory.nodes;
};
