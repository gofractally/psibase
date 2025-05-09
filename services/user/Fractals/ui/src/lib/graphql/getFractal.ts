import { z } from "zod";
import { graphql } from "../graphql";
import { Account, zAccount } from "../zodTypes";

export const zFractal = z.object({
  account: zAccount,
  createdAt: z.string(),
  name: z.string(),
  mission: z.string(),
})

export type Fractal = z.infer<typeof zFractal>

export const Response = z.object({
  data: zFractal,
});


export const getFractal = async (owner: Account): Promise<Fractal> => {
    const evaluation = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            name
            mission
        } 
    }`,
        "fractals",
    );

    const response = z
        .object({
            data: zFractal
        })
        .parse(evaluation);

    return response.data;
};
