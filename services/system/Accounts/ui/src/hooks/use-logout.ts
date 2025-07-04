import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { AwaitTime } from "@/globals";
import QueryKey from "@/lib/queryKeys";

import { useCurrentUser } from "./use-current-user";

const supervisor = getSupervisor();

export const useLogout = () => {
    const queryClient = useQueryClient();
    const [, setCurrentUser] = useCurrentUser();

    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
        },
        onSuccess: () => {
            setCurrentUser(null);
            setTimeout(() => {
                queryClient.refetchQueries({
                    queryKey: QueryKey.currentUser(),
                });
            }, AwaitTime);
        },
    });
};
