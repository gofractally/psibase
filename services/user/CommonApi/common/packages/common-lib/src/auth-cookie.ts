import { siblingUrl } from "./rpc";

// Vanilla JS page for receiving a token via postMessage from the supervisor subdomain,
// setting a cookie, and replying to the supervisor with the result.
// This file is intended to be served as a standalone HTML page.

const SUPERVISOR_ORIGIN = siblingUrl(undefined, "supervisor");

// Utility to get the caller app's domain (e.g., app.example.com)
function getCallerAppDomain() {
    // siblingUrl() returns the current app's origin
    return new URL(siblingUrl()).hostname;
}

/**
 * Utility to send a postMessage to the supervisor
 * @param {any} message
 */
function replyToSupervisor(message: any) {
    window.parent.postMessage(message, SUPERVISOR_ORIGIN);
}

// Listen for postMessage from supervisor
window.addEventListener("message", async (/** @type {MessageEvent} */ event) => {
    // Only accept messages from the supervisor subdomain
    if (event.origin !== SUPERVISOR_ORIGIN) {
        return;
    }
    const data = event.data;
    // Expecting { token: string, id?: string }
    if (!data || typeof data.token !== "string") {
        replyToSupervisor({
            status: "error",
            error: "Invalid message structure: missing token",
            id: data && data.id,
        });
        return;
    }
    const accessToken = data.token;
    const id = data.id;
    // Set cookie for the caller app's domain
    const cookieDomain = getCallerAppDomain();
    const cookie = `accessToken=${encodeURIComponent(accessToken)}; path=/; domain=${cookieDomain}; Secure; SameSite=Strict; max-age=3600`;
    let success = false;
    let error = undefined;
    try {
        document.cookie = cookie;
        // Check if cookie was set
        success = document.cookie.includes(`accessToken=${encodeURIComponent(accessToken)}`);
        if (!success) {
            error = "Cookie was not set. Check browser settings.";
        }
    } catch (e) {
        error = (e && typeof e === "object" && "message" in e) ? e.message : String(e);
    }
    // Reply to supervisor with result
    replyToSupervisor({
        status: success ? "ok" : "error",
        id,
        error,
    });
});

// Optionally, notify supervisor that the iframe is ready
replyToSupervisor({ status: "ready" });
