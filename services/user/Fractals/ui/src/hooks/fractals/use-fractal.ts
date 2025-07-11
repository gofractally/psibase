import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import { FractalRes, getFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../use-current-fractal";
import { setDefaultMembership } from "./use-membership";

export const useFractal = (account?: Account | undefined | null) => {
    const currentFractal = useCurrentFractal();
    const accountSelected = account || currentFractal;

    return useQuery<FractalRes>({
        queryKey: QueryKey.fractal(accountSelected),
        enabled: !!accountSelected,
        queryFn: async () => getFractal(zAccount.parse(accountSelected)),
    });
};

export const setDefaultFractal = (
    account: Account,
    firstUser: Account,
    name: string,
    mission: string,
) => {
    setDefaultMembership(account, firstUser);

    queryClient.setQueryData(QueryKey.fractal(account), () => {
        const defaultFractal: FractalRes = {
            fractal: {
                account,
                createdAt: new Date().toISOString(),
                mission,
                name,
            },
            evaluations: [],
        };
        return defaultFractal;
    });
};
