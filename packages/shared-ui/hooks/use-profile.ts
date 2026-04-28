import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { GraphQLUrlOptions, graphql } from "../lib/graphql";
import QueryKey from "../lib/query-keys";
import { zAccount } from "../lib/schemas/account";

export const ProfileResponse = z.object({
    profile: z
        .object({
            account: zAccount,
            displayName: z.string(),
            bio: z.string(),
        })
        .or(z.null()),
});

export const useProfile = (
    account: string | undefined | null,
    enabled = true,
    options: GraphQLUrlOptions = {},
) =>
    useQuery({
        queryKey: QueryKey.profile(account),
        enabled: !!account && enabled,
        queryFn: async () => {
            const res = await graphql(
                `
                query {
                    profile(account: "${account}") {
                        displayName
                        account
                        bio
                    }
                }
            `,
                {
                    service: "profiles",
                    ...options,
                },
            );

            return ProfileResponse.parse(res);
        },
    });
