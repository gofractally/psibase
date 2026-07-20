import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { ProfileResponse } from "@shared/hooks/use-profile";
import SharedQueryKey from "@shared/lib/query-keys";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

export const zParams = z.object({
    displayName: z.string(),
    bio: z.string(),
});

export const useSetProfile = () =>
    useMutation<void, Error, z.infer<typeof zParams>>({
        mutationFn: async (params) =>
            supervisor.functionCall({
                method: "setProfile",
                params: [params],
                service: "profiles",
                intf: "api",
            }),
        onSuccess: async (_, params, _id, context) => {
            toast.success("Profile updated");

            const currentUser = zAccount.parse(
                await context.client.getQueryData(SharedQueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            context.client.setQueryData(
                SharedQueryKey.profile(currentUser),
                (): z.infer<typeof ProfileResponse> => ({
                    profile: {
                        account: currentUser,
                        bio: params.bio,
                        displayName: params.displayName,
                    },
                }),
            );

            context.client.invalidateQueries({
                queryKey: SharedQueryKey.profile(currentUser),
            });
        },
        onError: () => {
            toast.error("Failed to set profile");
        },
    });
