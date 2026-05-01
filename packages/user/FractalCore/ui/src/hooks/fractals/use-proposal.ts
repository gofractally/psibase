import { useQuery } from "@tanstack/react-query";

import QueryKey, { OptionalNumber } from "@/lib/query-keys";

import { queryClient } from "@shared/lib/query-client";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

import { useGuildAccount } from "../use-guild-account";
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
                    intf: "userEval",
                });

                if (!res) return null;
                return zAccount.array().parse(res);
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
