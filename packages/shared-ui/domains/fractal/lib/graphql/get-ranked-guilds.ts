import { Account, zAccount } from "@shared/lib/schemas/account";
import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { guilds } from "@shared/lib/plugins";
import z from "zod";



export const getRankedGuilds = async (owner: Account): Promise<Account[]> => {
    const data = await graphqlAuth(
        guilds.authorized.graphql,
        `
    {
        rankedGuilds(fractal: "${owner}")
    }`,
    );

    return z.object({
        rankedGuilds: zAccount.array()
    }).parse(data).rankedGuilds
};
