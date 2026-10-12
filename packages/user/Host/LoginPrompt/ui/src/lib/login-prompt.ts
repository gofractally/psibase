import { supervisor } from "@shared/lib/supervisor";

const service = "host";
const plugin = "login-prompt";

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
