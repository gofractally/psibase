import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import { supervisor } from "@shared/lib/supervisor";

const service = "host";
const plugin = "login-prompt";

export function loginPromptCall<
    TParams extends unknown[] = [],
    TReturn = unknown,
>(intf: "api" | "admin", method: string): PluginCall<TParams, TReturn> {
    return {
        service,
        plugin,
        intf,
        method,
    };
}

export function callLoginPrompt<T>(
    intf: "api" | "admin",
    method: string,
    params: unknown[],
): Promise<T> {
    return supervisor.functionCall({
        service,
        plugin,
        intf,
        method,
        params,
    });
}
