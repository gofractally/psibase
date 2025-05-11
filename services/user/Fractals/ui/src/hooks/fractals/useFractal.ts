import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import {
    Fractal,
    getFractal,
    zFractal,
} from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../useCurrentFractal";
import { setDefaultMembership } from "./useMembership";

export const useFractal = (account?: Account | undefined | null) => {
    const accountSelected = account || useCurrentFractal();

    return useQuery<Fractal>({
        queryKey: QueryKey.fractal(accountSelected),
        enabled: !!accountSelected,
        queryFn: async () => getFractal(zAccount.parse(accountSelected)),
    });
};

export const setFractal = (
    account: Account,
    updater: (fractal: Fractal | undefined) => Fractal,
) => {
    queryClient.setQueryData(QueryKey.fractal(account), (fractalData: any) =>
        zFractal.parse(updater(fractalData)),
    );
};

export const setDefaultFractal = (
    account: Account,
    firstUser: Account,
    name: string,
    mission: string,
) => {
    setDefaultMembership(account, firstUser);

    queryClient.setQueryData(QueryKey.fractal(account), () => {
        const defaultFractal: Fractal = {
            account,
            createdAt: new Date().toISOString(),
            evaluationInterval: null,
            mission,
            name,
            rewardWaitPeriod: 86400,
            scheduledEvaluation: null,
        };
        return defaultFractal;
    });
};
