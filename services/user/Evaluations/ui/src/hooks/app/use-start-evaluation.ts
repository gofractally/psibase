import { queryClient } from "@/main";
import { zAccount } from "@lib/zod/Account";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const StartParams = z.object({
    evaluationId: z.number(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useStartEvaluation = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof StartParams>) => {
            const { evaluationId } = StartParams.parse(params);
            void (await getSupervisor().functionCall({
                method: "start",
                service: "evaluations",
                intf: "admin",
                params: [evaluationId],
            }));
            await wait(3000);
            await Promise.all([
                queryClient.refetchQueries({
                    queryKey: ["evaluation", evaluationId],
                }),
                queryClient.refetchQueries({
                    queryKey: ["users", evaluationId],
                }),
                queryClient.refetchQueries({
                    queryKey: ["groups", evaluationId],
                }),
            ]);
        },
    });
