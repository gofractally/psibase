import type {
    ExtractParams,
    ExtractResult,
    PluginCall,
} from "../../lib/plugins/lib/call-plugin-function";

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

import { callPluginFunction } from "../../lib/plugins/lib/call-plugin-function";

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
        queryFn: () => callPluginFunction(call, params),
    });
}
