import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { toast } from "@shared/shadcn/ui/sonner";

export const useCreateConnectionToken = () =>
    useMutation<string, Error>({
        mutationFn: async () =>
            // TODO: This should be its own useConnectAccount hook instead of hijacking
            //       the deprecated useCreateConnectionToken hook
            await supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "connectAccount",
                params: [],
            }),
        onSuccess: (_token) => {
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
