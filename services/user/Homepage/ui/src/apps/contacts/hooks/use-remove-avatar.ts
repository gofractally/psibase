import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supervisor } from "@/supervisor";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";
import { useCacheBust } from "@/hooks/use-cache-bust";
import { AwaitTime } from "@/globals";

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

            const currentUser = Account.parse(
                await queryClient.getQueryData(QueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            setTimeout(() => {
                setBustedUser(currentUser);
            }, AwaitTime)
        },
        onError: () => {
            toast.error("Failed to remove avatar from storage");
        },
    });
};
