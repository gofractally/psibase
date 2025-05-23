import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";
import { zUnix } from "@/lib/zod/Unix";

import { setDefaultMembership } from "./use-membership";

const Params = z.object({
    evalType: zEvalType,
    fractal: zAccount,
    registration: zUnix,
    deliberation: zUnix,
    submission: zUnix,
    finishBy: zUnix,
    intervalSeconds: z.number(),
    forceDelete: z.boolean(),
});

export const useSetSchedule = () =>
    useMutation<undefined, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const {
                fractal,
                registration,
                deliberation,
                submission,
                finishBy,
                intervalSeconds,
                forceDelete,
                evalType,
            } = Params.parse(params);

            toast.promise(
                async () => {
                    void (await supervisor.functionCall({
                        method: "setSchedule",
                        params: [
                            evalType,
                            fractal,
                            registration,
                            deliberation,
                            submission,
                            finishBy,
                            intervalSeconds,
                            forceDelete,
                        ],
                        service: fractalsService,
                        intf: "api",
                    }));
                },
                { description: "Scheduled evaluation" },
            );
        },
        onSuccess: (_, params) => {
            const { fractal } = Params.parse(params);

            const currentUser = zAccount.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            setDefaultMembership(fractal, currentUser);
            setTimeout(() => {
                queryClient.refetchQueries({
                    queryKey: QueryKey.fractal(fractal),
                });
            }, AwaitTime);
        },
    });
