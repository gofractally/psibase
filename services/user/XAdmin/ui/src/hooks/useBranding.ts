import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/queryKeys";

export const useBranding = ({ enabled = false }: { enabled?: boolean }) =>
    useQuery({
        queryKey: [queryKeys.branding],
        queryFn: async () => {
            // supervisor is only available after the chain boots
            const { getSupervisor } = await import("@psibase/common-lib");
            const supervisor = getSupervisor();

            const res = await supervisor.functionCall({
                service: "branding",
                intf: "queries",
                method: "getNetworkName",
                params: [],
            });
            return z.string().parse(res);
        },
        enabled,
    });
