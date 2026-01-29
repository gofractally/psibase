import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

import { graphql } from "./graphql";

const zProducerReturn = z.object({
    name: zAccount,
    auth: z.object({
        service: z.string(),
        rawData: z.string(),
    }),
});

export type Producer = z.infer<typeof zProducerReturn>;

export const getProducers = async (): Promise<Producer[]> => {
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
        "producers",
    );

    const response = z
        .object({
            producers: z.array(zProducerReturn),
        })
        .parse(producers);

    return response.producers;
};
