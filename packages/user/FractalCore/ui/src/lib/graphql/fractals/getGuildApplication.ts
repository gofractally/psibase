import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zGuildApplicationListInstance = z.object({
    member: zAccount,
    app: z.string(),
    createdAt: zDateTime,
    attestations: z
        .object({
            endorses: z.boolean(),
            comment: z.string(),
            attestee: zAccount,
        })
        .array(),
});

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
                        app
                        createdAt
                        attestations {
                            endorses
                            comment
                            attestee
                        }
                }
            }
        `,
        fractalsService,
    );

    return z
        .object({
            guildApplication: zGuildApplicationListInstance,
        })
        .parse(res).guildApplication;
};
