import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";
import { TokenId } from "@/lib/zod/token-id";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

const Args = z.object({
    tokenId: TokenId,
    creditor: zAccount,
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
            const parsedUser = zAccount.parse(user);

            // Invalidate queries to update the pending transactions table
            context.client.invalidateQueries({
                queryKey: QueryKey.userLinesOfCredit(parsedUser),
            });
        },
    });
