import { queryKeys } from "@/lib/queryKeys";
import { getJson } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useStatuses = () =>
    useQuery<string[], string>({
        queryKey: queryKeys.statuses,
        queryFn: async () => {
            try {
                const res = await getJson<string[]>("/native/admin/status");
                return z.string().array().parse(res);
            } catch (e) {
                console.error("Failed to fetch status", e);
                throw "Failed to fetch status";
            }
        },
        refetchInterval: 10000,
    });
