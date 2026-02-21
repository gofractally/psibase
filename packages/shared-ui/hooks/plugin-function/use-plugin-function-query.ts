import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

import { PluginCall } from ".";

type ExtractParams<T extends PluginCall> =
    T extends PluginCall<infer P, unknown> ? P : never;

type ExtractResult<T extends PluginCall> =
    T extends PluginCall<unknown[], infer R> ? R : never;

export function usePluginFunctionQuery<TCall extends PluginCall>(
    call: TCall,
    params: ExtractParams<TCall>,
    options: Omit<
        UseQueryOptions<ExtractResult<TCall>, Error>,
        "queryKey" | "queryFn"
    > = {},
) {
    const { intf, method, service } = call;

    type Result = ExtractResult<TCall>;

    return useQuery<Result, Error>({
        ...options,
        queryKey: [service, intf, method, params] as const,
        queryFn: async () => {
            const response = await supervisor.functionCall({
                service,
                intf,
                method,
                params,
            });

            return response as Result;
        },
    });
}
