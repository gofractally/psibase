import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

const Args = z.object({
    tokenId: z.string(),
    amount: z.string(),
    memo: z.string().default(""),
    receiver: Account,
});

export const useCredit = (user: string | null) => {
    return useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["credit"],
        mutationFn: (vars) => {
            const { receiver, amount, memo, tokenId } = Args.parse(vars);
            return supervisor.functionCall({
                service: "tokens",
                method: "credit",
                params: [tokenId, receiver, amount, memo],
                intf: "transfer",
            });
        },
        onSuccess: (_data, vars, _result, context) => {
            context.client.invalidateQueries({
                queryKey: QueryKey.userTokenBalanceChanges(
                    user,
                    Number(vars.tokenId),
                ),
            });
        },
    });
};
