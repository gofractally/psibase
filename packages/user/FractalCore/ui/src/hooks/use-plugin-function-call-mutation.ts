import { UseMutationOptions, useMutation } from "@tanstack/react-query";
import z from "zod";

import { TxStatus, checkLastTx } from "@/lib/checkStaging";
import { PluginCall } from "@/lib/plugin";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

type Toast = {
    success: string;
    error: string;
    loading: string;
};

type Options<Params> = UseMutationOptions<
    void,
    Error,
    Params,
    string | number
> & {
    toast?: Toast;
    onStagedTransaction?: (
        params: Params,
        status: TxStatus,
    ) => void | Promise<void>;
};

type ToastId = number | string;

export const usePluginFunctionCallMutation = <TCall extends PluginCall>(
    call: TCall,
    options: Options<TCall extends PluginCall<infer P> ? P : never>,
) => {
    const { intf, method, service } = call;

    return useMutation<
        void,
        Error,
        TCall extends PluginCall<infer P> ? P : never,
        ToastId
    >({
        ...options,
        mutationKey: [service, intf, method],
        mutationFn: async (params) => {
            return supervisor.functionCall({
                service,
                intf,
                method,
                params: z.any().array().parse(params),
            });
        },
        onMutate: (...arr) => {
            if (options.onMutate) {
                options.onMutate(...arr);
            }
            return toast.loading(options.toast?.loading);
        },
        onError: (...arr) => {
            if (options.onError) {
                options.onError(...arr);
            }

            const [error, functionCallParams, toastId] = arr;

            if (options.toast) {
                toast.error(options.toast.error, {
                    description: error.message,
                    id: toastId,
                });
            }
            console.error("Plugin function mutation failure:", {
                functionCallParams,
                error,
            });
        },
        onSuccess: async (...arr) => {
            if (options.onSuccess) {
                options.onSuccess(...arr);
            }
            if (options.toast) {
                const [_data, _params, toastId] = arr;
                toast.success(options.toast.success, {
                    id: toastId,
                });
            }
            if (options.onStagedTransaction) {
                const [_data, params] = arr;
                const lastTx = await checkLastTx();
                options.onStagedTransaction(params, lastTx);
            }
        },
    });
};
