import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

const Args = z.object({
    tokenId: TokenId,
    creditor: Account,
    memo: z.string().default(""),
});

export const useReject = (user: string | null, counterParty: string) =>
    useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["reject", counterParty],
        mutationFn: (vars) => {
            const { creditor, memo, tokenId } = Args.parse(vars);

            return supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "user",
                method: "reject",
                params: [tokenId, creditor, memo],
            });
        },
        onSuccess: (_data, _vars, _result, context) => {
            const parsedUser = Account.parse(user);

            // Invalidate queries to update the pending transactions table
            context.client.invalidateQueries({
                queryKey: QueryKey.userLinesOfCredit(parsedUser),
            });
        },
    });
