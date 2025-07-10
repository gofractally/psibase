import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

export const useBranding = () =>
    useQuery({
        queryKey: QueryKey.branding(),
        queryFn: async () => {
            return z.string().parse(
                await supervisor.functionCall({
                    service: "branding",
                    intf: "queries",
                    method: "getNetworkName",
                    params: [],
                }),
            );
        },
    });
