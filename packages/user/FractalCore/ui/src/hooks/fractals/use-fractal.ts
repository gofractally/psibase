import { useQuery } from "@tanstack/react-query";

import { FractalRes, getFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../use-current-fractal";

const queryFn = async (account: string) => {
    try {
        return await getFractal(zAccount.parse(account));
    } catch (error) {
        const message = "Error getting fractal";
        console.error(message, error);
        throw new Error(message);
    }
};

export const useFractal = (account?: Account | undefined | null) => {
    const currentFractal = useCurrentFractal();
    const accountSelected = account || currentFractal;

    return useQuery<FractalRes>({
        queryKey: QueryKey.fractal(accountSelected),
        enabled: Boolean(accountSelected),
        queryFn: () => queryFn(accountSelected!),
    });
};
