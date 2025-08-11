import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";
import { zAccount } from "./zod/Account";

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
            })
            .array(),
    }),
});

export const Response = z.object({
    details: zStagedTx.or(z.null()),
});

export const getStagedTx = async (id: number) => {
    const res = await graphql(
        `
                    {
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
                                }
                            }
                        }
                    }
                `,
        siblingUrl(null, "staged-tx", "/graphql"),
    );

    return Response.parse(res).details;
};
