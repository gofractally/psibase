import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const ProfileResponse = z.object({
    profile: z
        .object({
            account: Account,
            displayName: z.string(),
            bio: z.string(),
            avatar: z.boolean(),
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
                        avatar
                    }
                }
            `,
                "profiles",
            );

            return ProfileResponse.parse(res);
        },
    });
