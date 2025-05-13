import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    proposal: zAccount.array(),
});

export const usePropose = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            const { evaluationId, groupNumber, proposal } =
                Params.parse(params);

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
