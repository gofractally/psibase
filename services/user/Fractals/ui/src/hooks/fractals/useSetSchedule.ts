import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { zUnix } from "@/lib/zod/Unix";

import { setDefaultMembership } from "./useMembership";

const Params = z.object({
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
            } = Params.parse(params);

            void (await supervisor.functionCall({
                method: "setSchedule",
                params: [
                    fractal,
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    intervalSeconds,
                    forceDelete,
                ],
                service: "fractals",
                intf: "api",
            }));
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
