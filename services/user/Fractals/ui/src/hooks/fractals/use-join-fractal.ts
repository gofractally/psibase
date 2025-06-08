import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { assertUser } from "../use-current-user";
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

            const currentUser = assertUser();
            setDefaultMembership(fractal, currentUser);
            queryClient.refetchQueries({
                queryKey: QueryKey.membership(fractal, currentUser),
            });
        },
    });
