import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

const Args = z.object({
    tokenId: TokenId,
    debitor: Account,
    amount: z.string(),
    memo: z.string().default(""),
});

export const useUncredit = () =>
    useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["uncredit"],
        mutationFn: (vars) => {
            const { amount, memo, tokenId, debitor } = Args.parse(vars);
            return supervisor.functionCall({
                service: "tokens",
                method: "uncredit",
                params: [tokenId, debitor, amount, memo],
                intf: "transfer",
            });
        },
    });
