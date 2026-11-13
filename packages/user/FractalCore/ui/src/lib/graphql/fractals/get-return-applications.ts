import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

const zReturnApplication = z.object({
    applicant: zAccount,
    createdAt: z.string(),
});

export type ReturnApplication = z.infer<typeof zReturnApplication>;

export const getReturnApplications = async (
    fractalAccount: Account,
): Promise<ReturnApplication[]> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
        {
            returnApplications(fractal: "${fractalAccount}") {
                nodes {
                    applicant
                    createdAt
                }
            }
        }
        `,
    );

    return z
        .object({
            returnApplications: z.object({
                nodes: zReturnApplication.array(),
            }),
        })
        .parse(res).returnApplications.nodes;
};
