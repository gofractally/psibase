import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey, { OptionalNumber } from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useGuildSlug } from "../use-guild-id";
import { useFractalAccount } from "./use-fractal-account";

export const useProposal = (groupNumber: OptionalNumber) => {
    const guildSlug = useGuildSlug();
    const fractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.proposal(guildSlug, groupNumber),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    method: "getProposal",
                    params: [guildSlug, groupNumber],
                    service: fractal,
                    intf: "user",
                });

                return z.optional(zAccount.array()).parse(res);
            } catch (error) {
                const message = "Error getting proposal";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};

export const setCachedProposal = (
    guildSlug: string,
    groupNumber: number,
    accounts: Account[],
) => {
    queryClient.setQueryData(
        QueryKey.proposal(guildSlug, groupNumber),
        accounts,
    );
};
