import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";

export const useStatuses = () =>
    useQuery<string[], string>({
        queryKey: queryKeys.statuses,
        queryFn: async () => {
            try {
                const res = await chain.getStatus();
                return z.string().array().parse(res);
            } catch (e) {
                console.error("Failed to fetch status", e);
                throw "Failed to fetch status";
            }
        },
        refetchInterval: 10000,
    });
