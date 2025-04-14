import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "./use-current-user";
import { z } from "zod";
import { zAccount } from "@lib/zod/Account";

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
    currentUser: zAccount,
});

export const useAttest = () => {
    return useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            void (await getSupervisor().functionCall({
                method: "attest",
                service: "evaluations",
                intf: "api",
                params: [
                    params.evaluationId,
                    params.groupNumber,
                    params.currentUser,
                ],
            }));
        },
    });
};
