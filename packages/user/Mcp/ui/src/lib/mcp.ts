import { supervisor } from "@shared/lib/supervisor";

function returnPath() {
    return location.pathname || "/";
}

export async function mcpCall(
    intf: string,
    method: string,
    params: unknown[] = [],
) {
    return supervisor.functionCall(
        { service: "mcp", intf, method, params },
        { enabled: true, returnPath: returnPath() },
    );
}

export async function loginAsParent() {
    return supervisor.functionCall(
        {
            service: "host",
            plugin: "accounts",
            intf: "active-app",
            method: "connect-account",
            params: [],
        },
        { enabled: true, returnPath: returnPath() },
    );
}

export function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
