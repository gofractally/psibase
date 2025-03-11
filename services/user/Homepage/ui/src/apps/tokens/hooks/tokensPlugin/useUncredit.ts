import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

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
