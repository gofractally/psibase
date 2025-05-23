import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";

const zParams = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: zAccount.array(),
});

export const usePropose = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { evaluationId, groupNumber, proposal } =
                zParams.parse(params);

            const pars = {
                method: "propose",
                service: fractalsService,
                intf: "api",
                params: [evaluationId, groupNumber, proposal],
            };
            console.log("Proposing...", pars);

            void (await getSupervisor().functionCall(pars));
        },
    });
