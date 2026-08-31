import { z } from "zod";

import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplication = async (
    guildAccount: Account,
    applicant: Account,
) => {
    const res = await authorizedPluginGraphql(
        guilds.authorized.graphql,
        `
            {
                guildApplication(guild: "${guildAccount}", applicant: "${applicant}") {
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
        `,
    );

    return z
        .object({
            guildApplication: zGuildApplicationListInstance.nullable(),
        })
        .parse(res).guildApplication;
};
