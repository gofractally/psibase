import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";

const zStagedTx = z.object({
    id: z.number(),
    proposeDate: z.string(),
    proposer: zAccount,
    txid: z.string(),
    autoExec: z.boolean(),
    actionList: z.object({
        actions: z
            .object({
                sender: zAccount,
                method: z.string(),
                service: zAccount,
                rawData: z.string(),
            })
            .array(),
    }),
});

const zResponse = z.object({
    account: zAccount,
    accepted: z.boolean(),
});

export const zDataResponse = z.object({
    details: zStagedTx.or(z.null()),
    responses: z.object({
        nodes: zResponse.array(),
    }),
});

export const getStagedTx = async (id: number) => {
    const res = await graphql(
        `
                    {
                        responses(id: ${id}) {
                            nodes {
                                account
                                accepted
                            }
                        }
                        details(id: ${id}) {
                            id
                            autoExec
                            txid
                            proposer
                            proposeDate
                            actionList {
                                actions {
                                    sender
                                    method
                                    service
                                    rawData
                                }
                            }
                        }
                    }
                `,
        { service: "staged-tx" },
    );

    return zDataResponse.parse(res);
};
