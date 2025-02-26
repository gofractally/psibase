import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
  tokenId: TokenId,
  sender: Account,
  amount: z.string(),
  memo: z.string().default(""),
});

export const useDebit = () =>
  useMutation<void, Error, z.infer<typeof Args>>({
    mutationKey: ["debit"],
    mutationFn: (vars) => {
      const { sender, amount, memo, tokenId } = Args.parse(vars);
      return supervisor.functionCall({
        service: "tokens",
        method: "debit",
        params: [tokenId, sender, amount, memo],
        intf: "transfer"
      });
    },
  });
