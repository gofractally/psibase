import { queryClient, supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { toast } from "@shared/shadcn/ui/sonner";

export const useSelectAccount = () =>
    useMutation<void, Error, string>({
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
