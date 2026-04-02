import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

export const useLogout = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            return supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
        },
        onSuccess: () => {
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
        },
    });
};
