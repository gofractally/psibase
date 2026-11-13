import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const getExile = async (
    fractalAccount: Account,
    member: Account,
): Promise<boolean> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
        {
            exile(fractal: "${fractalAccount}", member: "${member}") {
                member
            }
        }
        `,
    );

    return z
        .object({
            exile: z.object({ member: zAccount }).nullable(),
        })
        .parse(res).exile !== null;
};
