import { z } from "zod";

import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await graphql(
        `
            {
                guildApplications(guild: "${guildAccount}") {
                    nodes {
                        applicant
                        extraInfo
                        createdAt
                        score {
                            current
                            required
                        }
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
        { service: GUILDS_SERVICE },
    );

    return z
        .object({
            guildApplications: z.object({
                nodes: zGuildApplicationListInstance.array(),
            }),
        })
        .parse(res).guildApplications.nodes;
};
