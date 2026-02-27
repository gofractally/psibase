import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zGuildAttestationListInstance = z.object({
    attester: zAccount,
    comment: z.string(),
    endorses: z.boolean(),
});

export const zGuildApplicationListInstance = z.object({
    applicant: zAccount,
    extraInfo: z.string(),
    createdAt: zDateTime,
    attestations: z.object({
        nodes: zGuildAttestationListInstance.array(),
    }),
});

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await graphql(
        `
            {
                guildApplications(guild: ${guildAccount}) {
                    nodes {
                        applicant
                        extraInfo
                        createdAt
                        attestations {
                            nodes {
                                attester
                                comment
                                endorses
                            }
                        }
                    }
                }
            }
        `,
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            guildApplications: z.object({
                nodes: zGuildApplicationListInstance.array(),
            }),
        })
        .parse(res).guildApplications.nodes;
};
