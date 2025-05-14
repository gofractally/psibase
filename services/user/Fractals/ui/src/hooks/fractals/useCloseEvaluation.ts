import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";

const Params = z.object({
    fractal: zAccount,
    evalType: zEvalType,
});

export const useCloseEvaluation = () =>
    useMutation<undefined, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const { fractal, evalType } = Params.parse(params);

            void (await supervisor.functionCall({
                method: "closeEval",
                params: [fractal, evalType],
                service: fractalsService,
                intf: "api",
            }));
        },
    });
