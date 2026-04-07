import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import {
    type FractalRes,
    getFractal,
} from "@shared/domains/fractal/lib/graphql/get-fractal";
import { type Account, zAccount } from "@shared/lib/schemas/account";

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
