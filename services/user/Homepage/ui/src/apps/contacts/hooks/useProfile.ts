import { graphql } from "@/lib/graphql";
import { Account } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const ProfileResposne = z.object({
    profile: z.object({
        displayName: z.string(),
        account: Account,
    }),
});

export const useProfile = (account: string | undefined | null) =>
    useQuery({
        queryKey: ["profile", account],
        enabled: !!account,
        queryFn: async () => {
            const res = await graphql(
                `
                query {
                    profile(account: "${account}") {
                        displayName
                        account
                    }
                }
            `,
                "profiles",
            );

            return ProfileResposne.parse(res);
        },
    });
