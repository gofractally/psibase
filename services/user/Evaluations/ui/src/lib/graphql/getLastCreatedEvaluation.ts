import { z } from "zod";
import { graphql } from "../graphql";
import { zAccount, Account } from "../zod/Account";

export const getLastCreatedEvaluationId = async (account: Account) => {
    const parsed = zAccount.parse(account);
    const res = await graphql(
        `{ getLastEvaluation(owner: ${parsed}) {
            id
            owner
        } }`,
        "evaluations",
    );

    const response = z
        .object({
            data: z.object({
                getLastCreatedEvaluation: z.object({
                    id: z.number(),
                    owner: zAccount,
                }),
            }),
        })
        .parse(res);

    return response.data.getLastCreatedEvaluation;
};
