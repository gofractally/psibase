import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
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
    const data = await authorizedPluginGraphql(
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
