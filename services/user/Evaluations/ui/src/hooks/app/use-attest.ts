import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
                intf: "user",
                params: [params.owner, params.evaluationId, params.groupNumber],
            }));
        },
    });
