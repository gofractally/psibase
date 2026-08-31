import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zFractal = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        stream: z.object({
            lastDistributed: zDateTime,
        }).nullable(),
        distIntervalSecs: z.number().int(),
        genesisTime: zDateTime,
        mission: z.string(),
        judiciary: z.object({
            account: zAccount,
            occupation: zAccount,
            roleId: z.number().int()
        }),
        legislature: z.object({
            account: zAccount,
            occupation: zAccount,
            roleId: z.number().int()
        }),
        executive: z.object({
            account: zAccount,
            occupation: zAccount,
            roleId: z.number().int()
        })
    })
    .or(z.null());

export const zFractalRes = z.object({
    fractal: zFractal,
});

export type FractalRes = z.infer<typeof zFractalRes>;

export const getFractal = async (owner: Account): Promise<FractalRes> => {
    const fractal = await authorizedPluginGraphql(
        fractals.authorized.graphql,
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            mission
            name
            stream {
                lastDistributed
            }
            distIntervalSecs
            genesisTime
            judiciary { 
                account
                occupation
                roleId
            }
            legislature { 
                account
                occupation
                roleId
            }
            executive { 
                account
                occupation
                roleId
            }
        }
    }`,
    );

    return zFractalRes.parse(fractal);
};
