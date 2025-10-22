import { graphql } from "@/gql";
import {
    GetFractalGuildQuery,
    GetFractalGuildQueryVariables,
} from "@/gql/graphql";
import { useQuery } from "@tanstack/react-query";

import { client } from "@/lib/graphql/client";

import { useFractalAccount } from "./use-fractal-account";

const query = graphql(`
    query GetFractalGuild($fractal: AccountNumber!) {
        fractal(fractal: $fractal) {
            account
            createdAt
            mission
            name
        }
        guilds(fractal: $fractal) {
            nodes {
                account
                rep {
                    member
                }
                displayName
                bio
                evalInstance {
                    evaluationId
                }
            }
        }
    }
`);

export const useFractal = () => {
    const currentFractal = useFractalAccount();
    const res = useQuery({
        queryKey: ["fractal", currentFractal],
        enabled: Boolean(currentFractal),
        queryFn: async () => {
            const res = await client.request<
                GetFractalGuildQuery,
                GetFractalGuildQueryVariables
            >(query, {
                fractal: currentFractal,
            });

            return res;
        },
    });

    return res;
};
