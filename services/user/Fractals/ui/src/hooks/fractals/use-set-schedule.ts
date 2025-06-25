import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";
import { zUnix } from "@/lib/zod/Unix";

import { assertUser } from "../use-current-user";
import { setDefaultMembership } from "./use-membership";

const zParams = z.object({
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
    useMutation<undefined, Error, z.infer<typeof zParams>>({
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
            } = zParams.parse(params);

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
                        intf: "admin",
                    }));
                },
                { description: "Scheduled evaluation" },
            );
        },
        onSuccess: (_, params) => {
            const { fractal } = zParams.parse(params);

            setDefaultMembership(fractal, assertUser());
            queryClient.refetchQueries({
                queryKey: QueryKey.fractal(fractal),
            });
        },
    });
