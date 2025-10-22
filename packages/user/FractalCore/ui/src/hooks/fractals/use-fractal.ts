import { graphql } from "@/gql";
import {
    GetFractalGuilQuery,
    GetFractalGuilQueryVariables,
} from "@/gql/graphql";
import { useQuery } from "@apollo/client/react";

import { useFractalAccount } from "./use-fractal-account";

const theFractal = graphql(`
    query GetFractalGuil($fractal: AccountNumber!) {
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
    const res = useQuery<GetFractalGuilQuery, GetFractalGuilQueryVariables>(
        theFractal,
        {
            variables: { fractal: currentFractal! },
            skip: !currentFractal,
        },
    );

    return res;
};
