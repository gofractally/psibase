import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalService } from "@/lib/constants";
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
                service: fractalService,
                intf: "user",
                params: [evaluationId, groupNumber, proposal],
            };

            void (await getSupervisor().functionCall(pars));
        },
        onError: (error) => {
            const message = "Error proposing:";
            console.error(message, error);
        },
    });
