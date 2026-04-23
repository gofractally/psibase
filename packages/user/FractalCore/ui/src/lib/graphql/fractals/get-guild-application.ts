import { z } from "zod";

import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplication = async (
    guildAccount: Account,
    applicant: Account,
) => {
    const res = await graphql(
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
        { service: GUILDS_SERVICE },
    );

    return z
        .object({
            guildApplication: zGuildApplicationListInstance.nullable(),
        })
        .parse(res).guildApplication;
};
