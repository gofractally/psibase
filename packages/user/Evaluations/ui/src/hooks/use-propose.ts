import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { EVALUATIONS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

const Params = z.object({
    owner: zAccount,
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: z.number().array(),
});

export const usePropose = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            const { owner, evaluationId, groupNumber, proposal } =
                Params.parse(params);
            const pars = {
                method: "propose",
                service: EVALUATIONS_SERVICE,
                intf: "user",
                params: [
                    owner,
                    evaluationId,
                    groupNumber,
                    proposal.map(String),
                ],
            };
            console.log("Proposing...", pars);

            void (await supervisor.functionCall(pars));
        },
    });
