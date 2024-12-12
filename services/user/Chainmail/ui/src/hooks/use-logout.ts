import { useQueryClient, useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@lib/supervisor";

export const useLogout = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            const supervisor = await getSupervisor();
            return supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
        },
        onSuccess: () => {
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            }, 2500);
        },
    });
};
