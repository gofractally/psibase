import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { producers } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

const zProducerReturn = z.object({
    name: zAccount,
    auth: z.object({
        service: z.string(),
        rawData: z.string(),
    }),
});

export type Producer = z.infer<typeof zProducerReturn>;

export const getProducers = async (): Promise<Producer[]> => {
    const data = await graphqlAuth(
        producers.authorized.graphql,
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
    );

    const response = z
        .object({
            producers: z.array(zProducerReturn),
        })
        .parse(data);

    return response.producers;
};
