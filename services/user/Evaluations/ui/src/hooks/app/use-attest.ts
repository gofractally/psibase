import { zAccount } from "@lib/zod/Account";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Params = z.object({
    owner: zAccount,
    evaluationId: z.number(),
    groupNumber: z.number(),
});

export const useAttest = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            void (await getSupervisor().functionCall({
                method: "attest",
                service: "evaluations",
                intf: "api",
                params: [params.owner, params.evaluationId, params.groupNumber],
            }));
        },
    });
