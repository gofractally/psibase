import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";

import { useCurrentFractal } from "../use-current-fractal";

const zParams = z.object({
    evaluationId: z.number(),
});

export const useCloseEvaluation = () => {
    const fractal = useCurrentFractal();

    return useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const { evaluationId } = zParams.parse(params);

            try {
                void (await supervisor.functionCall({
                    method: "closeEval",
                    params: [evaluationId],
                    service: fractalsService,
                    intf: "api",
                }));
            } catch (e) {
                const error = e as Error;
                // Here we assume that not finding the evaluation means
                // someone else beat us to it, so we will treat this as success
                if (!error.message.includes("not found")) {
                    throw e;
                }
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.fractal(fractal),
            });

            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(fractal),
                });
            }, AwaitTime);
        },
    });
};
