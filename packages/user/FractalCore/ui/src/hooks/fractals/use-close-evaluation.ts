import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { useFractalAccount } from "./use-fractal-account";

const zParams = z.object({
    evaluationId: z.number(),
});

export const useCloseEvaluation = () => {
    const fractal = useFractalAccount();

    return useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const { evaluationId } = zParams.parse(params);

            try {
                void (await supervisor.functionCall({
                    method: "closeEval",
                    params: [evaluationId],
                    service: fractalService,
                    intf: "admin",
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
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.fractal(fractal),
            });
        },
    });
};
