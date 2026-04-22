import { Account, zAccount } from "@shared/lib/schemas/account";
import { graphql } from "@shared/lib/graphql";
import { GUILDS_SERVICE } from "../constants";



export const getRankedGuilds = async (owner: Account): Promise<Account[]> => {
    const guilds = await graphql(
        `
    {
        rankedGuilds(fractal: "${owner}") {
            nodes {
                account
                rep {
                    member
                }
                displayName
                council
                bio
                evalInstance {
                  evaluationId
                }
            }
        }
    }`,
        { service: GUILDS_SERVICE },
    );

    console.log(guilds)
    return zAccount.array().parse(guilds);
};
