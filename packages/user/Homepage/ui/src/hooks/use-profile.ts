import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

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
    lookupProfile = true,
) =>
    useQuery({
        queryKey: QueryKey.profile(account),
        enabled: !!account && lookupProfile,
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
                "profiles",
            );

            return ProfileResponse.parse(res);
        },
    });
