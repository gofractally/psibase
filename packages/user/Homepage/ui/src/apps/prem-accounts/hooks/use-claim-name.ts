import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PREM_ACCOUNTS_SERVICE } from "@/apps/prem-accounts/lib/prem-service";
import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

export const useClaimName = () => {
    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();

    return useMutation({
        mutationFn: async (name: string) => {
            const parsed = zAccount.parse(name.trim());
            await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                plugin: "plugin",
                intf: "api",
                method: "claim",
                params: [parsed],
            });
            return parsed;
        },
        onMutate: (name) => ({
            toastId: toast.loading(`Claiming ${name}...`),
        }),
        onSuccess: (name, _, context) => {
            toast.success(`Successfully claimed account "${name}"`, {
                id: context.toastId,
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premUnclaimedNames(currentUser),
            });
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premNameEvents(currentUser),
            });
        },
        onError: (error, _, context) => {
            toast.error(error.message, { id: context?.toastId });
        },
    });
};
