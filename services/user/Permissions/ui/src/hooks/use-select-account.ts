import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "@shared/shadcn/ui/sonner";
import { z } from "zod";

import { supervisor } from "src/main";

export const useSelectAccount = () => {
    const queryClient = useQueryClient();

    return useMutation<void, Error, string>({
        mutationKey: ["selectAccount"],
        mutationFn: async (accountName: string) => {
            void (await supervisor.functionCall({
                method: "login",
                params: [z.string().parse(accountName)],
                service: "accounts",
                intf: "activeApp",
            }));
        },
        onSuccess: () => {
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};
