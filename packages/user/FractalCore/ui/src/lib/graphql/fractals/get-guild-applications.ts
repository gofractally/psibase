import { z } from "zod";

import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await authorizedPluginGraphql(
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
