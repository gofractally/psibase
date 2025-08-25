import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Account } from "@/lib/zod/Account";
import { Amount } from "@/lib/zod/Amount";
import { TokenId } from "@/lib/zod/TokenId";

const formSchema = z.object({
    token: TokenId,
    to: Account,
    amount: Amount,
    memo: z.string().max(50).optional(),
});

export type FormSchema = z.infer<typeof formSchema>;

export const useTokenForm = () => {
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
