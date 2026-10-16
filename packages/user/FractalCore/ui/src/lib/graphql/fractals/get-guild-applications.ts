import { z } from "zod";

import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { guilds } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await graphqlAuth(
        guilds.authorized.graphql,
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
    );

    return z
        .object({
            guildApplications: z.object({
                nodes: zGuildApplicationListInstance.array(),
            }),
        })
        .parse(res).guildApplications.nodes;
};
