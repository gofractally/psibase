/** Protocol constants for `x-wrtcsig` websocket transport. */

export const REALTIME_SUBPROTOCOL_V1 = "psibase.realtime.v1";
export const REALTIME_AUTH_SUBPROTOCOL_PREFIX = "psibase.bearer.";

/**
 * Local signaling service account (`#[psibase::service(name = "x-wrtcsig")]`).
 * Domain-oriented protocol name above; account string only for URL routing.
 */
export const REALTIME_SERVICE = "x-wrtcsig";
