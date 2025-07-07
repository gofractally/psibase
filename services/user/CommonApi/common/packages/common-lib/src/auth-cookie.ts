import { siblingUrl } from "./rpc";

// Vanilla JS page for receiving a token via postMessage from the Accounts app subdomain,
// setting a __Host-SESSION cookie via the /common/set-cookie endpoint, and replying to the Accounts app with the result.
// This file is intended to be served as a standalone HTML page.

const ACCOUNTS_ORIGIN = siblingUrl(undefined, "accounts");

/**
 * Utility to send a postMessage to the Accounts app
 * @param {any} message
 */
function replyToAccountsApp(message: any) {
    window.parent.postMessage(message, ACCOUNTS_ORIGIN);
}

console.log("🍪 Auth cookie script loaded (using /common/set-cookie endpoint)");

// Listen for postMessage from Accounts app
window.addEventListener("message", async (/** @type {MessageEvent} */ event) => {
    // Only accept messages from the Accounts app subdomain
    if (event.origin !== ACCOUNTS_ORIGIN) {
        console.log("❌ Rejecting message from wrong origin. Expected:", ACCOUNTS_ORIGIN, "Got:", event.origin);
        return;
    }
    const data = event.data;
    // Expecting { token: string, id?: string }
    if (!data || typeof data.token !== "string") {
        console.error("❌ Invalid message structure:", data);
        replyToAccountsApp({
            status: "error",
            error: "Invalid message structure: missing token",
            id: data && data.id,
        });
        return;
    }
    const accessToken = data.token;
    const id = data.id;
    
    let success = false;
    let error = undefined;
    try {
        // Use the new /common/set-cookie endpoint instead of client-side cookie setting
        const response = await fetch('/common/set-cookie', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ accessToken }),
        });
        
        if (response.ok) {
            success = true;
            console.log("🍪 Cookie set via /common/set-cookie endpoint");
            console.log("🍪 Response status:", response.status);
        } else {
            error = `Server returned ${response.status}: ${response.statusText}`;
            console.error("❌ Failed to set cookie:", error);
        }
    } catch (e) {
        console.error("❌ Error calling /common/set-cookie endpoint:", e);
        error = (e && typeof e === "object" && "message" in e) ? e.message : String(e);
    }
    // Reply to Accounts app with result
    const response = {
        status: success ? "ok" : "error",
        id,
        error,
    };
    console.log("📤 Sending response:", response);
    replyToAccountsApp(response);
});

// Optionally, notify Accounts app that the iframe is ready
console.log("✅ Auth cookie iframe ready, notifying Accounts app");
replyToAccountsApp({ status: "ready" });
