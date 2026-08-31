import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { evaluation } from "@shared/lib/plugins";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export const getLastCreatedEvaluationId = async (account: Account) => {
    const parsed = zAccount.parse(account);
    const res = await authorizedPluginGraphql(
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
