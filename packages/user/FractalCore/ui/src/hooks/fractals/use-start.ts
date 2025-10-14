import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { PluginError, getSupervisor } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zAccount,
});

export const useStart = () => {
    const fractalAccount = useFractalAccount();

    return useMutation<undefined, PluginError, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            await getSupervisor().functionCall({
                method: "startEval",
                params: [params.guildAccount],
                service: fractalAccount,
                intf: "adminGuild",
            });
        },
        onError: (error) => {
            const message = "Error starting evaluation";
            console.error(message, error);
        },
    });
};
