import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { useCacheBust } from "@/hooks/use-cache-bust";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

export const useRemoveAvatar = () => {
    const { setBustedUser } = useCacheBust();
    return useMutation({
        mutationFn: async () =>
            supervisor.functionCall({
                method: "removeAvatar",
                params: [],
                service: "profiles",
                intf: "api",
            }),
        onSuccess: async () => {
            toast.success("Avatar removed");

            const currentUser = zAccount.parse(
                await queryClient.getQueryData(QueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            setBustedUser(currentUser);
        },
        onError: () => {
            toast.error("Failed to remove avatar from storage");
        },
    });
};
