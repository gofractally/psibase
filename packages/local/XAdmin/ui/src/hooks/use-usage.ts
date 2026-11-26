import { useMutation, useQuery } from "@tanstack/react-query";

import {
    type UsageCountersType,
    type UsageReportOptions,
    getUsageQuotas,
    getUsageReport,
    setUsageQuota,
} from "@/lib/usage";

export const useUsageReport = (options: UsageReportOptions) =>
    useQuery({
        queryKey: ["usageReport", options],
        queryFn: () => getUsageReport(options),
        refetchInterval: 10000,
    });

export const useUsageQuotas = () =>
    useQuery({
        queryKey: ["usageQuotas"],
        queryFn: () => getUsageQuotas(),
        refetchInterval: 10000,
    });

export const useSetUsageQuota = () =>
    useMutation<
        void,
        Error,
        { identity: string; limits: Partial<UsageCountersType> }
    >({
        mutationKey: ["setUsageQuota"],
        mutationFn: ({ identity, limits }) => setUsageQuota(identity, limits),
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            context.client.invalidateQueries({ queryKey: ["usageQuotas"] });
            context.client.invalidateQueries({ queryKey: ["usageReport"] });
        },
    });
