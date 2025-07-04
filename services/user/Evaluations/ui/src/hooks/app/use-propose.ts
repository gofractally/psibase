import { zAccount } from "@/lib/zod/Account";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

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
                service: "evaluations",
                intf: "user",
                params: [
                    owner,
                    evaluationId,
                    groupNumber,
                    proposal.map(String),
                ],
            };
            console.log("Proposing...", pars);

            void (await getSupervisor().functionCall(pars));
        },
    });
