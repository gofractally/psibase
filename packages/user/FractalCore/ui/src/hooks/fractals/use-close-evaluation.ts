import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { useFractalAccount } from "./use-fractal-account";

const zParams = z.object({
    guildAccount: zGuildAccount,
});

export const useCloseEvaluation = () => {
    const fractal = useFractalAccount();

    return useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            try {
                const { guildAccount } = zParams.parse(params);

                void (await supervisor.functionCall({
                    method: "closeEval",
                    params: [guildAccount],
                    service: fractal,
                    intf: "adminGuild",
                }));
            } catch (e) {
                const error = e as Error;
                // Here we assume that not finding the evaluation means
                // someone else beat us to it, so we will treat this as success
                if (!error.message.includes("not found")) {
                    const message = "Error closing evaluation:";
                    console.error(message, e);
                    throw e;
                }
            }
        },
        onSuccess: (_, { guildAccount }) => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.fractal(fractal),
            });
            queryClient.invalidateQueries({
                queryKey: QueryKey.guild(guildAccount),
            });
        },
    });
};
