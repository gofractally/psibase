import { TokenId } from "@/lib/zod/TokenId";
import { supervisor } from "@/supervisor";
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
      return supervisor.functionCall({
        service: "tokens",
        method: "mint",
        params: [tokenId, amount, memo],
        intf: "intf"
      });
    },
  });
