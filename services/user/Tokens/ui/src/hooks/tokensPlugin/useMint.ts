import { functionCall } from "@/lib/functionCall";
import { TokenId } from "@/lib/types";
import { tokenPlugin } from "@/plugin";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Args = z.object({
  tokenId: TokenId,
  amount: z.string(),
  memo: z.string().default(""),
});

export const useMint = () =>
  useMutation<void, Error, z.infer<typeof Args>>({
    mutationKey: ["mint"],
    mutationFn: (vars) => {
      const { amount, memo, tokenId } = Args.parse(vars);
      return functionCall(tokenPlugin.intf.mint(tokenId, amount, memo));
    },
  });
