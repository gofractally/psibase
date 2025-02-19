import { functionCall } from "@/lib/functionCall";
import { tokenPlugin } from "@/plugin";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
  tokenId: z.string(),
  amount: z.string(),
  memo: z.string().default(""),
  account: z.string().default(""),
});

export const useBurn = () =>
  useMutation<void, Error, z.infer<typeof Args>>({
    mutationKey: ["burn"],
    mutationFn: (vars) => {
      const { account, amount, memo, tokenId } = Args.parse(vars);
      return functionCall(
        tokenPlugin.intf.burn(tokenId, amount, memo, account)
      );
    },
  });
