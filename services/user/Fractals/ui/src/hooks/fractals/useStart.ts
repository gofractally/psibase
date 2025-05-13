import { useMutation } from "@tanstack/react-query";

import { PluginError, getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { Account } from "@/lib/zod/Account";

export const useStart = () => {
    return useMutation<undefined, PluginError, Account>({
        mutationFn: async (fractal: Account) => {
            await getSupervisor().functionCall({
                method: "start",
                params: [fractal],
                service: fractalsService,
                intf: "api",
            });
        },
    });
};
