import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { evaluation } from "@shared/lib/plugins";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export const getLastCreatedEvaluationId = async (account: Account) => {
    const parsed = zAccount.parse(account);
    const res = await graphqlAuth(
        evaluation.authorized.graphql,
        `{ getLastEvaluation(owner: "${parsed}") {
            id
            owner
        } }`,
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
