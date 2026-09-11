import { Account, zAccount } from "@shared/lib/schemas/account";
import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
import z from "zod";



export const getRankedGuilds = async (owner: Account): Promise<Account[]> => {
    const data = await callGraphqlViaPlugin(
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
