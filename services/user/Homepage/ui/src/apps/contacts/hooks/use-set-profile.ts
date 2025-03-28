import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { AwaitTime } from "@/globals";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { ProfileResponse } from "../../../hooks/use-profile";

const Params = z.object({
    displayName: z.string(),
    bio: z.string(),
});

export const useSetProfile = () =>
    useMutation<void, Error, z.infer<typeof Params>>({
        mutationFn: async (params) =>
            supervisor.functionCall({
                method: "setProfile",
                params: [params],
                service: "profiles",
                intf: "api",
            }),
        onSuccess: async (_, params) => {
            toast.success("Profile updated");

            const currentUser = Account.parse(
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

            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.profile(currentUser),
                });
            }, AwaitTime);
        },
        onError: () => {
            toast.error("Failed to set profile");
        },
    });
