import { functionCall } from "@/lib/functionCall";
import { Account, TokenId } from "@/lib/types";
import { tokenPlugin } from "@/plugin";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
  tokenId: TokenId,
  receiver: Account,
  amount: z.string(),
  memo: z.string().default(""),
});

export const useUncredit = () =>
  useMutation<void, Error, z.infer<typeof Args>>({
    mutationKey: ["uncredit"],
    mutationFn: (vars) => {
      const { amount, memo, tokenId, receiver } = Args.parse(vars);
      return functionCall(
        tokenPlugin.transfer.uncredit(tokenId, receiver, amount, memo)
      );
    },
  });
