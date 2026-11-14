import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

export const hasRewardStream = async (
    fractal: Account,
    owner: Account,
): Promise<boolean> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
        {
            rewardStream(fractal: "${fractal}", owner: "${owner}") {
                owner
            }
        }
        `,
    );

    return z
        .object({
            rewardStream: z.object({ owner: z.string() }).nullable(),
        })
        .parse(res).rewardStream !== null;
};
