import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { setDefaultMembership } from "./use-membership";

const zParams = z.object({
    fractal: zAccount,
});

export const useJoinFractal = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const { fractal } = zParams.parse(params);

            void (await supervisor.functionCall({
                method: "join",
                params: [fractal],
                service: fractalsService,
                intf: "api",
            }));
        },
        onSuccess: (_, params) => {
            const { fractal } = zParams.parse(params);

            const currentUser = zAccount.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            setDefaultMembership(fractal, currentUser);
            setTimeout(() => {
                queryClient.refetchQueries({
                    queryKey: QueryKey.membership(fractal, currentUser),
                });
            }, AwaitTime);
        },
    });
