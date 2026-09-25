import type { SystemTokenInfo as PluginSystemTokenInfo } from "@shared/lib/plugins/tokens";

import { useQuery } from "@tanstack/react-query";

import { hostingAppCall } from "@shared/lib/plugins/host-app";
import {
    type PluginCall,
    callPluginFunction,
} from "@shared/lib/plugins/lib/call-plugin-function";
import QueryKey from "@shared/lib/query-keys";

export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
    /** Decimal places for the system token. */
    precision: number;
}

export function toSystemTokenInfo(
    token: PluginSystemTokenInfo | null | undefined,
): SystemTokenInfo | null {
    if (!token) {
        return null;
    }
    const symbol = token.symbol?.trim();
    return {
        id: String(token.id),
        symbol: symbol ? symbol : `ID: ${token.id}`,
        precision: token.precision,
    };
}

export const useSystemToken = (
    call: PluginCall<[], PluginSystemTokenInfo | undefined> = hostingAppCall(
        "tokens",
        "getSystemToken",
    ),
) =>
    useQuery<SystemTokenInfo | null>({
        queryKey: QueryKey.systemToken(),
        queryFn: async () =>
            toSystemTokenInfo(await callPluginFunction(call, [])),
    });
