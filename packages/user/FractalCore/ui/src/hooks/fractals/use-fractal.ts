import { useQuery } from "@tanstack/react-query";

import { FractalRes, getFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useFractalAccount } from "./use-fractal-account";

const queryFn = async (account: string) => {
    try {
        return await getFractal(zAccount.parse(account));
    } catch (error) {
        const message = "Error getting fractal";
        console.error(message, error);
        throw new Error(message);
    }
};

export const useFractal = () => {
    const currentFractal = useFractalAccount();
    return useQuery<FractalRes>({
        queryKey: QueryKey.fractal(currentFractal),
        enabled: Boolean(currentFractal),
        queryFn: () => queryFn(currentFractal!),
    });
};
