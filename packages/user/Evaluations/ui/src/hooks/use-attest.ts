import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Params = z.object({
    owner: zAccount,
    evaluationId: z.number(),
    groupNumber: z.number(),
});

export const useAttest = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            void (await supervisor.functionCall({
                method: "attest",
                service: "evaluations",
                intf: "user",
                params: [params.owner, params.evaluationId, params.groupNumber],
            }));
        },
    });
