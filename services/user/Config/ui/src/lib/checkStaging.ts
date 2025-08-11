import z from "zod";

import { getCurrentUser } from "@/hooks/useCurrentUser";

import { getActorHistory } from "./getActorHistory";
import { getStagedByProposer } from "./getStagedByProposer";

const zExecuted = z
    .object({
        type: z.literal("executed"),
        txId: z.string(),
    })
    .strict();

const zAwaiting = z
    .object({
        type: z.literal("awaiting"),
        txId: z.string(),
        stagedId: z.number(),
    })
    .strict();

export const zTxStatus = z.discriminatedUnion("type", [zExecuted, zAwaiting]);
export type TxStatus = z.infer<typeof zTxStatus>;

export const checkLastTx = async (): Promise<z.infer<typeof zTxStatus>> => {
    const currentUser = getCurrentUser()!;

    const actorHistory = await getActorHistory(currentUser);
    if (actorHistory.length == 0) {
        throw new Error("There is no actor history");
    }
    const latestId = z
        .string()
        .parse(
            actorHistory.sort(
                (a, b) =>
                    new Date(b.datetime).valueOf() -
                    new Date(a.datetime).valueOf(),
            )[0].txid,
        );

    const isExecuted = actorHistory.some(
        (item) => item.eventType == "executed" && item.txid == latestId,
    );
    if (isExecuted) {
        return zTxStatus.parse({
            type: "executed",
            txId: latestId,
        });
    } else {
        const res = await getStagedByProposer(currentUser);
        const id = res.find((x) => x.txid === latestId);
        if (!id)
            throw new Error(
                `Failed to find staged transaction of ${latestId} by proposer ${currentUser}`,
            );

        return zTxStatus.parse({
            type: "awaiting",
            txId: latestId,
            stagedId: id.id,
        });
    }
};
