import { siblingUrl } from "./rpc";
import { getSupervisor } from "./supervisor";

const WS_TICKET_SUBPROTOCOL_PREFIX = "psibase.ws-ticket.";

/**
 * Opens a websocket to a local service, authenticated as the current user.
 *
 * Gets a single-use ticket from `host:http/api.get-ws-ticket` and passes it as the
 * `psibase.ws-ticket.<ticket>` subprotocol. Call again for each connection attempt.
 *
 * @param service - The local (`x-`) service that will accept the websocket.
 * @param path - The path on the service to connect to (e.g. "/ws").
 * @param protocols - Additional subprotocols requested by the app.
 * @returns A new WebSocket; listen for `open` before sending.
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
