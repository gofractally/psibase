import { useMutation } from "@tanstack/react-query";
import z from "zod";

import { supervisor } from "@/supervisor";

import { zAccount } from "@/lib/types/account";

import { toast } from "@shared/shadcn/ui/sonner";

export const zParams = z.object({
    intf: zAccount,
    service: zAccount,
    method: z.string(),
});

type Params = z.infer<typeof zParams>;

type Meta<T> = {
    error: string;
    loading: string;
    success: string;
    isStagable?: false | undefined;
    onSuccess?: (params: T) => void;
    description?: string;
};

export const usePluginMutation = <T>(
    { intf, method, service }: Params,
    { error, loading, success, onSuccess, description }: Meta<T>,
) => {
    return useMutation<void, Error, T, string | number>({
        mutationKey: [service, intf, method],
        onMutate: () => {
            const res = toast.loading(loading);
            return res;
        },
        mutationFn: async (paramsArray) => {
            return supervisor.functionCall({
                service,
                intf,
                method,
                params: z.any().array().parse(paramsArray),
            });
        },
        onError: (errorObj, params, id) => {
            console.error({ service, intf, method, params, errorObj }, error);
            toast.error(error, {
                description: errorObj.message,
                id,
            });
        },
        onSuccess: async (_, params, id) => {
            if (onSuccess) {
                onSuccess(params);
            }
            toast.success(success, {
                id,
                description,
            });
        },
    });
};
