import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { ProfileResponse } from "../../../hooks/use-profile";

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
        onSuccess: async (_, params) => {
            toast.success("Profile updated");

            const currentUser = zAccount.parse(
                await queryClient.getQueryData(QueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            queryClient.setQueryData(
                QueryKey.profile(currentUser),
                (): z.infer<typeof ProfileResponse> => ({
                    profile: {
                        account: currentUser,
                        bio: params.bio,
                        displayName: params.displayName,
                    },
                }),
            );

            queryClient.invalidateQueries({
                queryKey: QueryKey.profile(currentUser),
            });
        },
        onError: () => {
            toast.error("Failed to set profile");
        },
    });
