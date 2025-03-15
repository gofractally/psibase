import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Account } from "@/lib/zod/Account";
import { ProfileResponse } from "@/hooks/useProfile";

export const useRemoveAvatar = () =>
    useMutation({
        mutationFn: async () =>
            supervisor.functionCall({
                method: "removeAvatar",
                params: [],
                service: "profiles",
                intf: "api",
            }),
        onSuccess: async () => {
            toast.success("Avatar removed");

            const currentUser = Account.parse(
                await queryClient.getQueryData(QueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            queryClient.setQueryData(
                QueryKey.profile(currentUser),
                (currentData: unknown) => {
                    if (currentData) {
                        const parsed = ProfileResponse.parse(currentData);
                        if (!parsed.profile) return;
                        const newData: z.infer<typeof ProfileResponse> = {
                            ...parsed,
                            profile: {
                                ...parsed.profile,
                                avatar: false,
                            },
                        };
                        return newData;
                    }
                },
            );
        },
        onError: () => {
            toast.error("Failed to remove avatar from storage");
        },
    });
