import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Account } from "@/lib/zod/Account";
import { Amount } from "@/lib/zod/Amount";
import { TokenId } from "@/lib/zod/TokenId";

import { TabType } from "./useTab";

const creditSchema = z.object({
    token: TokenId,
    to: Account,
    amount: Amount,
    memo: z.string().max(50).optional(),
});

const mintSchema = z.object({
    token: TokenId,
    amount: Amount,
});

const burnSchema = z.object({
    token: TokenId,
    to: Account,
    amount: Amount,
    from: z.string().default(""),
});

const formSchema = creditSchema.or(mintSchema).or(burnSchema);

export type FormSchema = z.infer<typeof formSchema>;

export const useTokenForm = (tab: TabType) => {
    const formSchema =
        tab == "Transfer"
            ? creditSchema
            : tab == "Mint"
              ? mintSchema
              : burnSchema;

    return useForm<FormSchema>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            amount: "",
            token: "",
            memo: "",
            to: "",
        },
        mode: "all",
    });
};
