import type { Account } from "@shared/lib/schemas/account";

import { UseMutationOptions } from "@tanstack/react-query";

import { PluginCall } from "../../lib/plugins/lib/call-plugin-function";

type Toast = {
    success: string;
    error: string;
    loading: string;
};

export type MutationOptions<TParams, TResult = unknown> = UseMutationOptions<
    TResult,
    Error,
    TParams,
    string | number
> & {
    toast?: Toast;
};

export type ToastId = number | string;

export abstract class PluginInterface {
    protected abstract readonly _intf: string;
    protected _service!: Account;

    protected _call<TParams extends unknown[] = [], TReturn = unknown>(
        method: string,
    ): PluginCall<TParams, TReturn> {
        return {
            intf: this._intf,
            method,
            service: this._service,
            _params: undefined,
            _return: undefined,
        } as const;
    }
}
