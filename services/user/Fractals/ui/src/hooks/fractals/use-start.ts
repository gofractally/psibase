import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { PluginError, getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";

const zParams = z.object({
    fractal: zAccount,
    evaluationType: zEvalType,
});

export const useStart = () => {
    return useMutation<undefined, PluginError, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            await getSupervisor().functionCall({
                method: "start",
                params: [params.fractal, params.evaluationType],
                service: fractalsService,
                intf: "api",
            });
        },
    });
};
