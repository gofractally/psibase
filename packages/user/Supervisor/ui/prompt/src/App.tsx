import React, { useCallback, useEffect, useState } from "react";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";

const supervisor = getSupervisor();

interface PromptDetails {
    promptApp: string;
    promptName: string;
    activeApp: string;
    created: string;
    packedContext: Uint8Array | null;
}

// This is the expiration time for displaying the prompt. If the prompt loads immediately,
// the user can take longer than this expiration to respond to the prompt.
//
// NOTE: This expiration also guards page refresh.
const PROMPT_EXPIRATION_SEC = 300;

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
                    intf: "admin",
                    method: "getActivePrompt",
                    params: [],
                })) as PromptDetails;

                if (promptDetails.created) {
                    const createdDate = new Date(promptDetails.created);
                    const now = new Date();
                    const diffSec =
                        (now.getTime() - createdDate.getTime()) / 1000;

                    if (diffSec > PROMPT_EXPIRATION_SEC) {
                        setError("Prompt expired");
                        return;
                    }
                }

                setActiveApp(promptDetails.activeApp);

                const iframeUrl = new URL(
                    siblingUrl(null, promptDetails.promptApp, null, true),
                );

                // The well-known path for the web platform is currently
                //  `/plugin/web/prompt/<prompt-name>`
                iframeUrl.pathname = `/plugin/web/prompt/${promptDetails.promptName}`;

                setIframeUrl(iframeUrl.toString());
            } catch (e) {
                setError("Prompt error: " + e);
            }
        };

        initApp();
    }, []);

    const promptFinished = useCallback(
        async (event: MessageEvent) => {
            if (!iframeUrl) return;

            if (event.origin !== new URL(iframeUrl).origin) {
                return;
            }

            if (event.data === "finished") {
                const rootDomain = new URL(
                    siblingUrl(null, activeApp, returnPath, true),
                );
                window.location.href = rootDomain.toString();
            }
        },
        [iframeUrl, activeApp, returnPath],
    );

    useEffect(() => {
        if (!iframeUrl) return;
        window.addEventListener("message", promptFinished);
        return () => {
            window.removeEventListener("message", promptFinished);
        };
    }, [iframeUrl, promptFinished]);

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
