import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

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
