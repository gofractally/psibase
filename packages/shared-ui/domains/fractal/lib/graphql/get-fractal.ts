import { z } from "zod";

import { FRACTALS_SERVICE } from "../constants";

import { graphql } from "@shared/lib/graphql";
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
            occupation: zAccount,
            roleId: z.number().int()
        }),
        legislature: z.object({
            occupation: zAccount,
            roleId: z.number().int()
        }),
        executive: z.object({
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
    const fractal = await graphql(
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
                occupation
                roleId
            }
            legislature { 
                occupation
                roleId
            }
            executive { 
                occupation
                roleId
            }
        }
    }`,
        { service: FRACTALS_SERVICE },
    );

    return zFractalRes.parse(fractal);
};
