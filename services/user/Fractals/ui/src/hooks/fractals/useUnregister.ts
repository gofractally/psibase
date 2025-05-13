import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";

const Params = z.object({
    evaluationId: z.number(),
});

export const useUnregister = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            void (await getSupervisor().functionCall({
                method: "unregister",
                service: fractalsService,
                intf: "api",
                params: [params.evaluationId],
            }));

            // TODO:
            // addUserToCache(params.owner, params.id, currentUser);
        },
    });
