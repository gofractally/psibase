import React, { useEffect, useState } from "react";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";

const supervisor = getSupervisor();

interface PromptDetails {
    subdomain: string;
    activeApp: string;
    payload: string;
    contextId: number | null;
    expired: boolean;
}

export const App = () => {
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [returnPath, setReturnPath] = useState<string | null>(null);
    const [activeApp, setActiveApp] = useState<string | null>(null);

    useEffect(() => {
        const initApp = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            setReturnPath(urlParams.get("returnPath") || "/");

            try {
                const promptDetails = (await supervisor.functionCall({
                    service: "host",
                    plugin: "prompt",
                    intf: "api",
                    method: "getActivePrompt",
                    params: [],
                })) as PromptDetails;

                if (promptDetails.expired) {
                    setError("Prompt expired");
                    return;
                }

                setActiveApp(promptDetails.activeApp);

                const iframeUrl = new URL(
                    siblingUrl(null, promptDetails.subdomain, null, true),
                );

                // The well-known path for the web platform is currently
                //  `/plugin/web/prompt/<prompt-name>`
                iframeUrl.pathname = `/plugin/web/prompt/${promptDetails.payload}`;
                if (promptDetails.contextId) {
                    iframeUrl.searchParams.set(
                        "context_id",
                        promptDetails.contextId.toString(),
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

            if (event.data === "finished") {
                await supervisor.functionCall({
                    service: "host",
                    plugin: "prompt",
                    intf: "api",
                    method: "deleteActivePrompt",
                    params: [],
                });

                const rootDomain = new URL(
                    siblingUrl(null, activeApp, returnPath, true),
                );
                window.location.href = rootDomain.toString();
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
