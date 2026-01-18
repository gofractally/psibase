import { useMutation } from "@tanstack/react-query";
import z from "zod";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { MutationOptions, PluginCall } from ".";

type ToastId = number | string;

export const usePluginFunctionMutation = <TCall extends PluginCall>(
    call: TCall,
    options: MutationOptions<
        TCall extends PluginCall<infer P, unknown> ? P : never,
        TCall extends PluginCall<unknown[], infer R> ? R : never
    > = {},
) => {
    const { intf, method, service } = call;

    type Params = TCall extends PluginCall<infer P, unknown> ? P : never;
    type Result = TCall extends PluginCall<unknown[], infer R> ? R : never;

    return useMutation<Result, Error, Params, ToastId>({
        ...options,
        mutationKey: [service, intf, method],

        mutationFn: async (params: Params): Promise<Result> => {
            const parsedParams = z.array(z.unknown()).parse(params);

            console.log("Function call:", {
                parsedParams,
                service,
                intf,
                method,
            });

            const response = await supervisor.functionCall({
                service,
                intf,
                method,
                params: parsedParams,
            });

            return response as Result;
        },

        onMutate: (variables, context) => {
            options.onMutate?.(variables, context);
            return toast.loading(options.toast?.loading);
        },

        onError: (err, variables, toastId, context) => {
            options.onError?.(err, variables, toastId, context);

            if (options.toast) {
                toast.error(options.toast.error, {
                    description: err.message,
                    id: toastId,
                });
            }

            console.error("Plugin function mutation failure:", {
                variables,
                error: err,
            });
        },

        onSuccess: (data, variables, toastId, context) => {
            options.onSuccess?.(data, variables, toastId, context);

            if (options.toast) {
                toast.success(options.toast.success, {
                    id: toastId,
                });
            }
        },
    });
};
