import { z } from "zod";

import { zAccount } from "@/lib/zod/Account";

import { graphql } from "../graphql";

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
                producers: z.array(
                    z.object({
                        name: zAccount,
                        auth: z.object({
                            service: z.string(),
                            rawData: z.string(),
                        }),
                    }),
                ),
            }),
        })
        .parse(producers);

    return response.data.producers.map((producer) => producer.name);
};
