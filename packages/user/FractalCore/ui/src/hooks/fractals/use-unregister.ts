import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "@/lib/queryKeys";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { assertUser } from "@shared/hooks/use-current-user";
import { queryClient } from "@shared/lib/queryClient";
import { toast } from "@shared/shadcn/ui/sonner";

import { useFractalAccount } from "./use-fractal-account";
import { updateParticipants } from "./use-users-and-groups";

export const zParams = z.object({
    evaluationId: z.number(),
    guildAccount: zGuildAccount,
});

export const useUnregister = () => {
    const fractalAccount = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            updateParticipants(params.evaluationId, assertUser(), false);

            void (await getSupervisor().functionCall({
                method: "unregister",
                service: fractalAccount,
                intf: "userEval",
                params: [params.guildAccount],
            }));
        },
        onError: (error, params) => {
            updateParticipants(params.evaluationId, assertUser(), true);
            const message = "Error unregistering";
            console.error(message, error);
            toast.error(message);
            queryClient.invalidateQueries({
                queryKey: QueryKey.usersAndGroups(params.evaluationId),
            });
        },
    });
};
