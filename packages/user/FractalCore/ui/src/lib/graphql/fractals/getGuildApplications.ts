import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";

import { Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";
import { zDateTime } from "@/lib/zod/DateTime";
import dayjs from "dayjs";


export const zGuildApplicationListInstance = z.object({
    applicant: zAccount,
    createdAt: zDateTime.transform(dayjs),
    attestations: z
        .object({
            nodes: z.object({
                endorses: z.boolean()
            }).array(),

        })
        ,
});

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;

export const getGuildApplications = async (guildAccount: Account) => {
    const res = await graphql(
        `
            {
                guildApplications(guild: "${guildAccount}") {
                    nodes {
                        applicant
                        createdAt
                        attestations {
                            nodes {
                            endorses
                            }
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
