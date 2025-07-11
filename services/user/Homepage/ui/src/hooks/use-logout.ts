import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

import { setCurrentUser } from "./use-current-user";

export const useLogout = () =>
    useMutation({
        mutationKey: ["logout"],
        mutationFn: async () =>
            supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            }),
        onSuccess: () => {
            setCurrentUser(null);
            queryClient.refetchQueries({
                queryKey: QueryKey.currentUser(),
            });
        },
    });
