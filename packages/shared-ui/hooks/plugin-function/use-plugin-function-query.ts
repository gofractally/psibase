import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

import { PluginCall } from ".";

type ExtractParams<T extends PluginCall> =
    T extends PluginCall<infer P, unknown> ? P : never;

type ExtractResult<T extends PluginCall> =
    T extends PluginCall<unknown[], infer R> ? R : never;

export async function pluginFunctionQuery<TCall extends PluginCall>(
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

export function usePluginFunctionQuery<
    TCall extends PluginCall,
    TData = ExtractResult<TCall>,
>(
    call: TCall,
    params: ExtractParams<TCall>,
    options: Omit<
        UseQueryOptions<ExtractResult<TCall>, Error, TData>,
        "queryKey" | "queryFn"
    > = {},
) {
    const { intf, method, service } = call;

    type Result = ExtractResult<TCall>;

    return useQuery<Result, Error, TData>({
        ...options,
        queryKey: [service, intf, method, params] as const,
        queryFn: () => pluginFunctionQuery(call, params),
    });
}
