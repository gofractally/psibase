import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

export const zGuildApplicationListInstance = z
    .object({
        member: zAccount,
        extraInfo: z.string(),
        createdAt: zDateTime,
        attestations: z
            .object({
                endorses: z.boolean(),
                comment: z.string(),
                attestee: zAccount,
            })
            .array(),
    })
    .nullable();

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;

export const getGuildApplication = async (
    guildAccount: Account,
    member: Account,
) => {
    const res = await graphql(
        `
            {
                guildApplication(guild: ${guildAccount}, member: "${member}") {
                        member
                        extraInfo
                        createdAt
                        attestations {
                            endorses
                            comment
                            attestee
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
