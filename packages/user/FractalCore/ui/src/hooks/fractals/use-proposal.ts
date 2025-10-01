import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey, { OptionalAccount, OptionalNumber } from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useFractalAccount } from "./use-fractal-account";

export const useProposal = (groupNumber: OptionalNumber) => {
    const fractalAccount = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.proposal(fractalAccount, groupNumber),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    method: "getProposal",
                    params: [fractalAccount, groupNumber],
                    service: fractalAccount,
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
    fractalAccount: OptionalAccount,
    groupNumber: number,
    accounts: Account[],
) => {
    queryClient.setQueryData(
        QueryKey.proposal(fractalAccount, groupNumber),
        accounts,
    );
};
