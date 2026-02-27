import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zGuildApplicationListInstance } from "@/lib/zod/attestations";

import { graphql } from "@shared/lib/graphql";
import { Account } from "@shared/lib/schemas/account";

export const getGuildApplication = async (
    guildAccount: Account,
    applicant: Account,
) => {
    const res = await graphql(
        `
            {
                guildApplication(guild: ${guildAccount}, applicant: "${applicant}") {
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
        `,
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            guildApplication: zGuildApplicationListInstance,
        })
        .parse(res).guildApplication;
};
