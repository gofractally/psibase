import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export const getLastCreatedEvaluationId = async (account: Account) => {
    const parsed = zAccount.parse(account);
    const res = await graphql(
        `{ getLastEvaluation(owner: "${parsed}") {
            id
            owner
        } }`,
        { service: "evaluations" },
    );

    const response = z
        .object({
            getLastEvaluation: z.object({
                id: z.number(),
                owner: zAccount,
            }),
        })
        .parse(res);

    return response.getLastEvaluation;
};
