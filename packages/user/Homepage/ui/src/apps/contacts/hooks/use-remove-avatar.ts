import { useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useCacheBust } from "@shared/hooks/use-cache-bust";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
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
        onSuccess: async (_data, _variables, _onMutateResult, context) => {
            toast.success("Avatar removed");

            const currentUser = zAccount.parse(
                await context.client.getQueryData(QueryKey.currentUser()),
            );
            if (!currentUser) throw new Error("No current user");

            setBustedUser(currentUser);
        },
        onError: () => {
            toast.error("Failed to remove avatar from storage");
        },
    });
};
