import { z } from "zod";

import { GraphQLUrlOptions, graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";

const zProducerReturn = z.object({
    name: zAccount,
    auth: z.object({
        service: z.string(),
        rawData: z.string(),
    }),
});

export type Producer = z.infer<typeof zProducerReturn>;

export const getProducers = async (
    opts: GraphQLUrlOptions = {},
): Promise<Producer[]> => {
    const producers = await graphql(
        `
            {
                producers {
                    name
                    auth {
                        service
                        rawData
                    }
                }
            }
        `,
        { service: "producers", ...opts },
    );

    const response = z
        .object({
            producers: z.array(zProducerReturn),
        })
        .parse(producers);

    return response.producers;
};
