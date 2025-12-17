import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import {
    FractalRes,
    getFractal,
    zFractalRes,
} from "@/lib/graphql/fractals/getFractal";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { zAccount } from "@shared/lib/schemas/account";

import { useFractalAccount } from "./use-fractal-account";

const queryFn = async (account: string): Promise<FractalRes> => {
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

export const invalidateFractal = (
    fractal: OptionalAccount = getSubDomain(),
) => {
    queryClient.invalidateQueries({
        queryKey: QueryKey.fractal(fractal),
    });
};

export const updateFractalCache = (
    updater: (fractal: FractalRes) => FractalRes,
    fractal: OptionalAccount = getSubDomain(),
) => {
    queryClient.setQueryData(QueryKey.fractal(fractal), (data: unknown) => {
        const parsedFractal = zFractalRes.safeParse(data);
        if (parsedFractal.success) {
            const updatedData = zFractalRes.safeParse(
                updater(parsedFractal.data),
            );
            if (updatedData.success) {
                return updatedData.data;
            } else {
                console.warn(
                    "Cached data updater returned invalid schema instance",
                    updatedData.error,
                );
                return parsedFractal.data;
            }
        }
    });
    invalidateFractal(fractal);
};
