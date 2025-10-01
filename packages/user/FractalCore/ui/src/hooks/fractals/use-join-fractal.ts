import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { assertUser } from "../use-current-user";
import { setDefaultMembership } from "./use-membership";

const zParams = z.object({
    fractal: zAccount,
});

const mutationFn = async (fractal: string) => {
    try {
        await supervisor.functionCall({
            method: "join",
            params: [fractal],
            service: fractal,
            intf: "user",
        });
    } catch (error) {
        const message = "Error joining fractal";
        console.error(message, error);
        throw new Error(message);
    }
};

export const useJoinFractal = () =>
    useMutation<undefined, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) => {
            const { fractal } = zParams.parse(params);
            void (await mutationFn(fractal));
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
