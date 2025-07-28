import { z } from "zod";

import { zAccount } from "@/lib/zod/Account";

import { graphql } from "../graphql";

const zProducer = z.object({
    name: zAccount,
    auth: z.object({
        service: z.string(),
        rawData: z.string(),
    }),
});

export type Producer = z.infer<typeof zProducer>;

export const getProducers = async () => {
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
            data: z.object({
                producers: z.array(zProducer),
            }),
        })
        .parse(producers);

    return response.data.producers;
};
