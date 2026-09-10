import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
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
    const data = await callGraphqlViaPlugin(
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
