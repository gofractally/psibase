import { useMutation, useQueryClient } from "@tanstack/react-query";

import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";

import { useExpectCurrentUser } from "./use-expect-current-user";

export const useLogout = () => {
    const queryClient = useQueryClient();
    const [, setExpectCurrentUser] = useExpectCurrentUser();

    return useMutation({
        mutationKey: QueryKey.logout(),
        mutationFn: async () =>
            supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            }),
        onSuccess: () => {
            setExpectCurrentUser(false);
            queryClient.setQueryData(QueryKey.currentUser(), null);
        },
        onError: (error) => {
            const message = "Error logging out";
            console.error(message, error);
        },
    });
};
