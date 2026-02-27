import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { graphql } from "@shared/lib/graphql";
import { Account } from "@shared/lib/schemas/account";

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
