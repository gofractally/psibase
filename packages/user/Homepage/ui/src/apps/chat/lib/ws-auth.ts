import { supervisor } from "@shared/lib/supervisor";

/** Bearer query token for subjective websocket auth while running as a Homepage sub-app. */
export async function getHomepageQueryToken(): Promise<string | null> {
    const user = await supervisor.functionCall({
        service: "accounts",
        plugin: "plugin",
        intf: "api",
        method: "get-current-user",
        params: [],
    });
    if (!user) return null;

    const token = await supervisor.functionCall({
        service: "host",
        plugin: "auth",
        intf: "api",
        method: "get-active-query-token",
        params: ["homepage", user],
    });

    return token ?? null;
}
