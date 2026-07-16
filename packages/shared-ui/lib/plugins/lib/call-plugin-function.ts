import type { Account } from "@shared/lib/schemas/account";

import { supervisor } from "@shared/lib/supervisor";

export type PluginCall<
    TParams extends unknown[] = unknown[],
    TReturn = unknown,
> = {
    readonly intf: string;
    readonly method: string;
    readonly service: Account;
    readonly _params?: TParams;
    readonly _return?: TReturn;
};

export type ExtractParams<T extends PluginCall> =
    T extends PluginCall<infer P, unknown> ? P : never;

export type ExtractResult<T extends PluginCall> =
    T extends PluginCall<unknown[], infer R> ? R : never;

export async function callPluginFunction<TCall extends PluginCall>(
    call: TCall,
    params: ExtractParams<TCall>,
): Promise<ExtractResult<TCall>> {
    const { intf, method, service } = call;

    const response = await supervisor.functionCall({
        service,
        plugin: "plugin",
        intf,
        method,
        params,
    });

    return response as ExtractResult<TCall>;
}
