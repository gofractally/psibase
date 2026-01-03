import type { Account } from "@shared/lib/schemas/account";

import { UseMutationOptions, useMutation } from "@tanstack/react-query";
import z from "zod";

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
};

type ToastId = number | string;

// Shared call type with typed params
export type PluginCall<T extends unknown[] = unknown[]> = {
    readonly intf: string;
    readonly method: string;
    readonly service: Account;
    // Phantom for inference
    readonly _params?: T;
};

export abstract class PluginInterface {
    protected abstract readonly _intf: string;

    // Will be set by Plugin constructor
    protected _service!: Account;

    protected _call<T extends unknown[] = []>(method: string): PluginCall<T> {
        return {
            intf: this._intf,
            method,
            service: this._service,
            _params: undefined,
        } as const;
    }
}

// === Interfaces ===

export const usePluginFunctionMutation = <TCall extends PluginCall>(
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
        },
    });
};
