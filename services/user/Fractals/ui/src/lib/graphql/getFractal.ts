import { z } from "zod";
import { graphql } from "../graphql";
import { Account, zAccount, zDateTime } from "../zodTypes";

export const zFractal = z.object({
    account: zAccount,
    createdAt: zDateTime,
    name: z.string(),
    mission: z.string(),
});

export type Fractal = z.infer<typeof zFractal>;

export const getFractal = async (owner: Account) => {
    const fractal = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            name
            mission
        } 
    }`,
    );

    return z
        .object({
                fractal: zFractal.or(z.null()),
        })
        .parse(fractal).fractal;

};
