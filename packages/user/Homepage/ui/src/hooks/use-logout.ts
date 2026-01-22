import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

import { useConnectedAccounts } from "./use-connected-accounts";
import { setCurrentUser } from "./use-current-user";

export const useLogout = () => {
    const { data: connectedAccounts } = useConnectedAccounts();
    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            await supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
            for (const account of connectedAccounts) {
                await supervisor.functionCall({
                    method: "disconnect",
                    params: [account],
                    service: "accounts",
                    intf: "activeApp",
                });
            }
        },
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            setCurrentUser(null);
            context.client.invalidateQueries({
                queryKey: QueryKey.currentUser(),
            });
            context.client.invalidateQueries({
                queryKey: QueryKey.connectedAccounts(),
            });
        },
    });
};
