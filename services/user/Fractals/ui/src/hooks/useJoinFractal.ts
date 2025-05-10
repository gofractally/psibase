import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { AwaitTime } from "@/lib/globals";
import QueryKey from "@/lib/queryKeys";

import { setDefaultMembership } from "./useMembership";
import { zAccount } from "@/lib/zod/Account";

const Params = z.object({
    fractal: zAccount,
});

export const useJoinFractal = () =>
    useMutation<undefined, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const { fractal } = Params.parse(params);

            void (await supervisor.functionCall({
                method: "join",
                params: [fractal],
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
                    queryKey: QueryKey.membership(fractal, currentUser),
                });
            }, AwaitTime);
        },
    });
