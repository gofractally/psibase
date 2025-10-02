import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "@/lib/queryKeys";
import { zGuildSlug } from "@/lib/zod/Wrappers";

import { toast } from "@shared/shadcn/ui/sonner";

import { assertUser } from "../use-current-user";
import { useFractalAccount } from "./use-fractal-account";
import { updateParticipants } from "./use-users-and-groups";

export const zParams = z.object({
    evaluationId: z.number(),
    guildSlug: zGuildSlug,
});

export const useUnregister = () => {
    const fractalAccount = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            updateParticipants(params.evaluationId, assertUser(), false);

            void (await getSupervisor().functionCall({
                method: "unregister",
                service: fractalAccount,
                intf: "user",
                params: [params.evaluationId],
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
