import React, { useEffect, useState } from "react";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";

const supervisor = getSupervisor();

interface TriggerDetails {
    subdomain: string;
    payload: string;
    contextId: number | null;
}

export const App = () => {
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const initApp = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const prompt_id = urlParams.get("id");
            if (!prompt_id) {
                setError("User prompt request error: No id provided");
                return;
            }
            const returnUrl = urlParams.get("returnUrl") || "/";

            try {
                const triggerDetails = (await supervisor.functionCall({
                    service: "host",
                    plugin: "prompt",
                    intf: "api",
                    method: "getPromptTriggerDetails",
                    params: [prompt_id, returnUrl],
                })) as TriggerDetails;

                const iframeUrl = new URL(
                    siblingUrl(null, triggerDetails.subdomain, null, true),
                );

                // The well-known path for the web platform is therefore currently
                //  `/plugin/web/prompt/<prompt-name>.html`
                iframeUrl.pathname = `/plugin/web/prompt/${triggerDetails.payload}.html`;
                if (triggerDetails.contextId) {
                    iframeUrl.searchParams.set(
                        "context_id",
                        triggerDetails.contextId.toString(),
                    );
                }

                setIframeUrl(iframeUrl.toString());
            } catch (e) {
                setError("Prompt error: " + e);
            }
        };

        initApp();
    }, []);

    useEffect(() => {
        if (!iframeUrl) return;

        const handleMessage = async (event: MessageEvent) => {
            if (event.origin !== new URL(iframeUrl).origin) {
                return;
            }
            const urlParams = new URLSearchParams(window.location.search);
            const prompt_id = urlParams.get("id");
            if (!prompt_id) {
                setError("User prompt request error: No id provided");
                return;
            }

            if (event.data === "finished") {
                const returnDetails = (await supervisor.functionCall({
                    service: "host",
                    plugin: "prompt",
                    intf: "api",
                    method: "getReturnDetails",
                    params: [prompt_id],
                })) as string | null;

                if (!returnDetails) {
                    console.error(
                        "No return url provided! Returning to homepage.",
                    );
                    const rootDomain = new URL(
                        siblingUrl(null, null, null, true),
                    );
                    window.location.href = rootDomain.toString();
                    return;
                }

                const returnUrl = new URL(returnDetails);
                window.location.href = returnUrl.toString();
            }
        };
        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [iframeUrl]);

    if (error) {
        return <div>{error}</div>;
    }

    return (
        <div
            style={{
                width: "100%",
                height: "100dvh",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            {iframeUrl && (
                <iframe
                    src={iframeUrl}
                    style={{
                        width: "50%",
                        height: "50dvh",
                        border: "none",
                    }}
                />
            )}
        </div>
    );
};
