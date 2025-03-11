import { Account } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
    tokenId: z.string(),
    amount: z.string(),
    memo: z.string().default(""),
    account: z.string().optional(),
});

export const useBurn = () =>
    useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["burn"],
        mutationFn: (vars) => {
            const { account, amount, memo, tokenId } = Args.parse(vars);
            return supervisor.functionCall({
                service: "tokens",
                method: "burn",
                params: [tokenId, amount, memo, account || ""],
                intf: "intf",
            });
        },
    });
