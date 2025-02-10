import { functionCall } from "@/lib/functionCall";
import { Account } from "@/lib/types";
import { tokenPlugin } from "@/plugin";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
  tokenId: z.string(),
  amount: z.string(),
  memo: z.string().default(""),
  receiver: Account,
});

export const useCredit = () =>
  useMutation<void, Error, z.infer<typeof Args>>({
    mutationKey: ["credit"],
    mutationFn: (vars) => {
      const { receiver, amount, memo, tokenId } = Args.parse(vars);
      return functionCall(
        tokenPlugin.transfer.credit(tokenId, receiver, amount, memo)
      );
    },
  });
