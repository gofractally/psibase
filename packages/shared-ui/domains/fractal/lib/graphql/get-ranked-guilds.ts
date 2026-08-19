import { Account, zAccount } from "@shared/lib/schemas/account";
import { graphql } from "@shared/lib/graphql";
import { GUILDS_SERVICE } from "../constants";
import z from "zod";



export const getRankedGuilds = async (owner: Account): Promise<Account[]> => {
    const guilds = await graphql(
        `
    {
        rankedGuilds(fractal: "${owner}")
    }`,
        { service: GUILDS_SERVICE },
    );

    return z.object({
        rankedGuilds: zAccount.array()
    }).parse(guilds).rankedGuilds
};
