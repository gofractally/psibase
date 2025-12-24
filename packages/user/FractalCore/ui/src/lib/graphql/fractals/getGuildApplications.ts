import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

import { zDateTime } from "@/lib/zod/DateTime";

export const zGuildApplicationListInstance = z.object({
    member: zAccount,
    extraInfo: z.string(),
    createdAt: zDateTime,
    attestations: z
        .object({
            endorses: z.boolean(),
        })
        .array(),
});

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await graphql(
        `
            {
                guildApplications(guild: ${guildAccount}) {
                    nodes {
                        member
                        extraInfo
                        createdAt
                        attestations {
                            endorses
                        }
                    }
                }
            }
        `,
        FRACTALS_SERVICE,
    );

    return z
        .object({
            guildApplications: z.object({
                nodes: zGuildApplicationListInstance.array(),
            }),
        })
        .parse(res).guildApplications.nodes;
};
