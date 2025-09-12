import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Account } from "@/lib/zod/Account";
import { zAmount } from "@/lib/zod/Amount";
import { TokenId } from "@/lib/zod/TokenId";

import { Token } from "./tokensPlugin/useBalances";

export const formSchema = (tokens: Token[]) =>
    z
        .object({
            token: TokenId,
            to: Account,
            amount: zAmount,
            memo: z.string().max(50).optional(),
        })
        .refine(
            ({ amount, token }) => {
                if (!token || !amount) return true;
                const selectedToken = tokens.find(
                    (t) => t.id === Number(token),
                );
                if (!selectedToken) return true;
                // Check decimal places don't exceed precision
                const parts = amount.split(".");
                if (parts.length === 1) {
                    // No decimal part, so it's valid
                    return true;
                }
                const decimalPart = parts[1];
                return decimalPart.length <= selectedToken.precision;
            },
            ({ token }) => {
                const selectedToken = tokens.find(
                    (t) => t.id === Number(token),
                );
                return {
                    message: `Amount cannot have more than ${selectedToken?.precision ?? 0} decimal places`,
                    path: ["amount"],
                };
            },
        );

export type FormSchema = z.infer<ReturnType<typeof formSchema>>;

export const useTokenForm = (tokens: Token[]) => {
    return useForm<FormSchema>({
        resolver: zodResolver(formSchema(tokens)),
        defaultValues: {
            amount: "",
            token: "",
            memo: "",
            to: "",
        },
        mode: "all",
    });
};
