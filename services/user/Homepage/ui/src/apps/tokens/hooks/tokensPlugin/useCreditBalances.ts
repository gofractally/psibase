import { Account } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const CreditBalance = z.object({
    balance: z.string(),
    creditor: Account,
    debitor: Account,
    tokenId: z.number(),
});

export const useCreditBalances = () =>
    useQuery<z.infer<typeof CreditBalance>[]>({
        queryKey: ["balances", "transfer"],
        queryFn: async () => {
            const rawData = await supervisor.functionCall({
                service: "tokens",
                method: "balances",
                params: [],
                intf: "transfer",
            });
            return CreditBalance.array().parse(rawData);
        },
    });
