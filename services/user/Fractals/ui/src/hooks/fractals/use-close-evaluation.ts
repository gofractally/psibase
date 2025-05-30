import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";

const zParams = z.object({
    fractal: zAccount,
    evalType: zEvalType,
});

export const useCloseEvaluation = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const { fractal, evalType } = zParams.parse(params);

            void (await supervisor.functionCall({
                method: "closeEval",
                params: [fractal, evalType],
                service: fractalsService,
                intf: "api",
            }));
        },
        onSuccess: (_, params) => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.fractal(params.fractal),
            });

            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(params.fractal),
                });
            }, AwaitTime);
        },
    });
