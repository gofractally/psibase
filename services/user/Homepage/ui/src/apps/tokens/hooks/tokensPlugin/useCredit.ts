import { Account } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
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
      return supervisor.functionCall({
        service: "token",
        method: "credit",
        params: [tokenId, receiver, amount, memo],
        intf: "transfer"
      });
    },
  });
