import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@shared/lib/query-keys";
import { supervisor } from "@shared/lib/supervisor";

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
                console.error("Error getting network branding", error);
                throw error;
            }
        },
    });
