import { functionCall } from "@/lib/functionCall";
import { Account, TokenId } from "@/lib/types";
import { tokenPlugin } from "@/plugin";
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
      return functionCall(
        tokenPlugin.transfer.debit(tokenId, sender, amount, memo)
      );
    },
  });
