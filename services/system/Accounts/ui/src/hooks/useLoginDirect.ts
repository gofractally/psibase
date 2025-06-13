import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

const LoginParams = z.object({
    app: z.string(),
    origin: z.string(),
    accountName: z.string(),
});

const supervisor = getSupervisor();

// Helper function to create iframe and set cookie
const setCookieViaIframe = (token: string, origin: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        console.log("🚀 setCookieViaIframe called with:");
        console.log("  Token:", token);
        console.log("  Origin:", origin);
        console.log("  Current window.location.origin:", window.location.origin);
        
        const iframe = document.createElement("iframe");
        const iframeSrc = `${origin}/common/auth-cookie.html`;
        iframe.src = iframeSrc;
        iframe.style.display = "none";
        
        console.log("📱 Creating iframe with src:", iframeSrc);

        const handleMessage = (event: MessageEvent) => {
            console.log("📨 Received message from iframe:");
            console.log("  Event origin:", event.origin);
            console.log("  Expected origin:", origin);
            console.log("  Message data:", event.data);
            
            // Only accept messages from the app's origin
            if (event.origin !== origin) {
                console.log("❌ Rejecting message from wrong origin");
                return;
            }

            const data = event.data;
            console.log("🍪 Accepted message from iframe:", data);

            if (data.status === "ready") {
                // Send token to iframe
                console.log("📤 Sending token to iframe:", { token });
                iframe.contentWindow?.postMessage({ token }, origin);
            } else if (data.status === "ok") {
                // Cookie set successfully
                console.log("✅ Cookie set successfully");
                cleanup();
                resolve();
            } else if (data.status === "error") {
                // Error setting cookie
                console.error("❌ Error setting cookie:", data.error);
                cleanup();
                reject(new Error(data.error || "Failed to set cookie"));
            }
        };

        const cleanup = () => {
            window.removeEventListener("message", handleMessage);
            document.body.removeChild(iframe);
        };

        window.addEventListener("message", handleMessage);
        document.body.appendChild(iframe);

        // Timeout after 10 seconds
        setTimeout(() => {
            cleanup();
            reject(new Error("Cookie setting timeout"));
        }, 10000);
    });
};

export const useLoginDirect = () =>
    useMutation<void, Error, z.infer<typeof LoginParams>>({
        mutationFn: async (params) => {
            const { accountName, app, origin } = LoginParams.parse(params);
            console.log("useLoginDirect().origin:", origin);

            const queryToken = await supervisor.functionCall({
                method: "loginDirect",
                params: [
                    {
                        app,
                        origin,
                    },
                    accountName,
                ],
                service: "accounts",
                intf: "admin",
            });
            console.log("returned queryToken:", queryToken);

            // Set cookie via iframe
            if (queryToken) {
                await setCookieViaIframe(queryToken, origin);

                console.log(
                    "done waiting for set-cookie iframe; redirecting...",
                );
                window.location.href = origin;
            }
        },
    });
