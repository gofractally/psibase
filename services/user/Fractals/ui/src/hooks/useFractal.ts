import { getFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useCurrentFractal } from "./useCurrentFractal";
import { Account, zAccount } from "@/lib/zod/Account";

export const Fractal = z.object({
  account: zAccount,
  createdAt: z.string(),
  name: z.string(),
  mission: z.string(),
})

export const useFractal = (account?: Account | undefined | null) => {

  const accountSelected = account || useCurrentFractal();

  return useQuery({
    queryKey: QueryKey.fractal(accountSelected),
    enabled: !!accountSelected,
    queryFn: async () => getFractal(zAccount.parse(accountSelected)),
  });
}
