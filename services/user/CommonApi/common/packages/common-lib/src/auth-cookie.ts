import { siblingUrl } from "./rpc";

// Vanilla JS page for receiving a token via postMessage from the Accounts app subdomain,
// setting a cookie, and replying to the Accounts app with the result.
// This file is intended to be served as a standalone HTML page.

const ACCOUNTS_ORIGIN = siblingUrl(undefined, "accounts");

// Utility to get the caller app's domain (e.g., app.example.com)
function getCallerAppDomain() {
    // siblingUrl() returns the current app's origin
    return new URL(siblingUrl()).hostname;
}

/**
 * Utility to send a postMessage to the Accounts app
 * @param {any} message
 */
function replyToAccountsApp(message: any) {
    window.parent.postMessage(message, ACCOUNTS_ORIGIN);
}

console.log("🍪 Auth cookie script loaded");
console.log("🌐 ACCOUNTS_ORIGIN:", ACCOUNTS_ORIGIN);
console.log("🏠 Current domain:", getCallerAppDomain());

// Listen for postMessage from Accounts app
window.addEventListener("message", async (/** @type {MessageEvent} */ event) => {
    console.log("📨 Auth cookie received message:", event.data, "from:", event.origin);
    
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
    console.log("🎫 Received token:", accessToken.substring(0, 20) + "...");
    
    // Set cookie for the caller app's domain
    const cookieDomain = getCallerAppDomain();
    const cookie = `accessToken=${encodeURIComponent(accessToken)}; path=/; domain=${cookieDomain}; Secure; SameSite=Strict; max-age=3600`;
    console.log("🍪 Setting cookie:", cookie.substring(0, 100) + "...");
    
    let success = false;
    let error = undefined;
    try {
        const existingCookies = document.cookie.split(";").map(c => c.trim());
        existingCookies.push(cookie);
        document.cookie = existingCookies.join("; ");
        // Check if cookie was set
        success = document.cookie.includes(`accessToken=${encodeURIComponent(accessToken)}`);
        console.log("🍪 Cookie set success:", success);
        console.log("🍪 All cookies:", document.cookie);
        if (!success) {
            error = "Cookie was not set. Check browser settings.";
        }
    } catch (e) {
        console.error("❌ Error setting cookie:", e);
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
