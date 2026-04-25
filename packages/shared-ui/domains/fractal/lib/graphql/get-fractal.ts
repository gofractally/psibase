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
            distIntervalSecs: z.number().int(),
        }).nullable(),
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
                distIntervalSecs
            }
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
        { service: FRACTALS_SERVICE },
    );

    return zFractalRes.parse(fractal);
};
