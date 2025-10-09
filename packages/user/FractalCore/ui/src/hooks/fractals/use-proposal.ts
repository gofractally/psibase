import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey, { OptionalNumber } from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useGuildAccount } from "../use-guild-id";
import { useFractalAccount } from "./use-fractal-account";

export const useProposal = (groupNumber: OptionalNumber) => {
    const guildAccount = useGuildAccount();
    const fractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.proposal(guildAccount, groupNumber),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    method: "getProposal",
                    params: [guildAccount, groupNumber],
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
    guildAccount: Account,
    groupNumber: number,
    accounts: Account[],
) => {
    queryClient.setQueryData(
        QueryKey.proposal(guildAccount, groupNumber),
        accounts,
    );
};
