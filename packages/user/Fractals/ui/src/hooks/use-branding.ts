import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

export const useBranding = () =>
    useQuery({
        queryKey: QueryKey.branding(),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    service: "branding",
                    intf: "queries",
                    method: "getNetworkName",
                    params: [],
                });
                return z.string().parse(res);
            } catch (error) {
                const message = "Error getting network branding";
                console.error(message, error);
                throw error;
            }
        },
    });
