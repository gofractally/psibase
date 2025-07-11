import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

export const useBranding = () =>
    useQuery({
        queryKey: ["branding"],
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: "branding",
                intf: "queries",
                method: "getNetworkName",
                params: [],
            });
            return z.string().parse(res);
        },
    });
