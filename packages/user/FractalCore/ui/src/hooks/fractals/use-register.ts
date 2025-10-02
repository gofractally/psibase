import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "@/lib/queryKeys";
import { zGuildSlug } from "@/lib/zod/Wrappers";

import { toast } from "@shared/shadcn/ui/sonner";

import { assertUser } from "../use-current-user";
import { useEvaluationInstance } from "./use-evaluation-instance";
import { useFractalAccount } from "./use-fractal-account";
import { updateParticipants } from "./use-users-and-groups";

export const zParams = z.object({
    slug: zGuildSlug,
});

export const useRegister = () => {
    const fractalAccount = useFractalAccount();

    const { evaluation } = useEvaluationInstance();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            updateParticipants(evaluation!.id, assertUser(), true);

            void (await getSupervisor().functionCall({
                method: "register",
                service: fractalAccount,
                intf: "user",
                params: [params.slug],
            }));
        },
        onError: (error) => {
            updateParticipants(evaluation!.id, assertUser(), false);
            const message = "Error registering";
            console.error(message, error);
            toast.error(message);
            queryClient.invalidateQueries({
                queryKey: QueryKey.usersAndGroups(evaluation!.id),
            });
        },
    });
};
