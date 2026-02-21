import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

export const zGuildApplicationListInstance = z
    .object({
        applicant: zAccount,
        extraInfo: z.string(),
        createdAt: zDateTime,
        attestations: z.object({
            nodes: z
            .object({
                endorses: z.boolean(),
                comment: z.string(),
                attester: zAccount,
            })
            .array()
        }),
    })
    .nullable();

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;

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
                                endorses
                                comment
                                attester
                            }
                        }
                }
            }
        `,
        FRACTALS_SERVICE,
    );

    return z
        .object({
            guildApplication: zGuildApplicationListInstance,
        })
        .parse(res).guildApplication;
};
