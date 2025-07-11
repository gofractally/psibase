import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

import { assertUser } from "../use-current-user";
import { updateParticipants } from "./use-users-and-groups";

export const zParams = z.object({
    evaluationId: z.number(),
});

export const useRegister = () => {
    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            updateParticipants(params.evaluationId, assertUser(), true);

            void (await getSupervisor().functionCall({
                method: "register",
                service: fractalsService,
                intf: "user",
                params: [params.evaluationId],
            }));
        },
        onError: (error, params) => {
            updateParticipants(params.evaluationId, assertUser(), false);
            toast.error(error.message);
            queryClient.invalidateQueries({
                queryKey: QueryKey.usersAndGroups(params.evaluationId),
            });
        },
    });
};
