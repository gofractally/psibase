import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { ProfileResponse } from "../../../hooks/useProfile";
import { Account } from "@/lib/zod/Account";
import { AwaitTime } from "@/globals";

const Params = z.object({
    displayName: z.string(),
    bio: z.string(),
    avatar: z.boolean(),
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
                        avatar: params.avatar,
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
