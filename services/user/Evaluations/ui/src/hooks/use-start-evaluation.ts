import { queryClient } from "@/main";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const StartParams = z.object({
    id: z.number(),
    entropy: z.number(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useStartEvaluation = () =>
    useMutation({
        mutationFn: async (params: z.infer<typeof StartParams>) => {
            const { id, entropy } = StartParams.parse(params);
            void (await getSupervisor().functionCall({
                method: "start",
                service: "evaluations",
                intf: "api",
                params: [id, entropy],
            }));
            await wait(2500);
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ["evaluation", id] }),
                queryClient.refetchQueries({ queryKey: ["users", id] }),
                queryClient.refetchQueries({ queryKey: ["groups", id] }),
            ]);
        },
    });
