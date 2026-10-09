import { siblingUrl } from "./rpc";
import { getSupervisor } from "./supervisor";

const WS_TICKET_SUBPROTOCOL_PREFIX = "psibase.ws-ticket.";

/**
 * Opens an authenticated websocket to a local service.
 *
 * @param service - The local (`x-`) service that will accept the websocket.
 * @param path - The path on the service to connect to (e.g. "/ws").
 * @param protocols - Additional subprotocols requested by the app.
 * @returns A new WebSocket. Listen for `open` before sending.
 */
export async function openServiceWebSocket(
    service: string,
    path: string,
    protocols: string[] = [],
): Promise<WebSocket> {
    const ticket = (await getSupervisor().functionCall({
        service: "host",
        plugin: "http",
        intf: "api",
        method: "get-ws-ticket",
        params: [service],
    })) as string;
    const url = siblingUrl(null, service, path).replace(/^http/, "ws");
    return new WebSocket(url, [
        ...protocols,
        `${WS_TICKET_SUBPROTOCOL_PREFIX}${ticket}`,
    ]);
}
