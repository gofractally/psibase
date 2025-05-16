import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";

import { useEvaluationInstance } from "./useEvaluationInstance";

const Params = z.object({
    fractal: zAccount,
    evalType: zEvalType,
});

export const useCloseEvaluation = () => {
    const { evaluationInstance } = useEvaluationInstance();
    return useMutation<undefined, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const { fractal, evalType } = Params.parse(params);

            void (await supervisor.functionCall({
                method: "closeEval",
                params: [fractal, evalType],
                service: fractalsService,
                intf: "api",
            }));
        },
        onSuccess: () => {
            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.usersAndGroups(
                        evaluationInstance!.evaluationId,
                    ),
                });
            }, AwaitTime);
        },
    });
};
