import { getFractal } from "@/lib/graphql/getFractal";
import QueryKey from "@/lib/queryKeys";
import { Account,  zAccount } from "@/lib/zodTypes";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const Fractal = z.object({
  account: zAccount,
  createdAt: z.string(),
  name: z.string(),
  mission: z.string(),
})

export const useFractal = (account: Account | undefined | null) =>
  useQuery({
    queryKey: QueryKey.fractal(account),
    enabled: !!account,
    queryFn: async () => getFractal(zAccount.parse(account)),
  });
