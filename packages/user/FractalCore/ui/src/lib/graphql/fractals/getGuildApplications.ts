import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zGuildApplicationListInstance = z.object({
    member: zAccount,
    app: z.string(),
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

export const getGuildApplications = async (guildId: number) => {
    const res = await graphql(
        `
            {
                guildApplications(guildId: ${guildId}) {
                    nodes {
                        member
                        app
                        createdAt
                        attestations {
                            endorses
                        }
                    }
                }
            }
        `,
        fractalsService,
    );

    return z
        .object({
            guildApplications: z.object({
                nodes: zGuildApplicationListInstance.array(),
            }),
        })
        .parse(res).guildApplications.nodes;
};
