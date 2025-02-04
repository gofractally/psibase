import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { TabType } from "./useMode";

const Amount = z.string().refine((amount) => amount.length > 0);
const Account = z
  .string()
  .min(1, { message: "Account must be at least 1 character." })
  .max(50);
const TokenId = z.string();

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
    tab == "Transfer" ? creditSchema : tab == "Mint" ? mintSchema : burnSchema;

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
