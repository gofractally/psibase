import { useCallback, useEffect, useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { ErrorCard } from "@shared/components/error-card";
import { supervisor } from "@shared/lib/supervisor";

import { loadGuestSession } from "../../src/guest-session";

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

// Whether this browser has ever been through the account-and-key prompt.
// Someone who has keeps getting it; everyone else is offered the passkey
// path, which links to this prompt for those who want it.
const CLASSIC_KEY = "psibase.used-classic-prompt.v1";
const hasImportedAccounts = () =>
    window.localStorage.getItem(CLASSIC_KEY) !== null;

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
                        setError("This prompt has expired.");
                        return;
                    }
                }

                setActiveApp(promptDetails.activeApp);
                if (urlParams.has("classic")) {
                    window.localStorage.setItem(CLASSIC_KEY, "1");
                }

                // A passkey guest who asks to connect an account is offered
                // the way to create one. "classic" keeps the original
                // prompt, for importing an existing account or key.
                if (
                    promptDetails.promptApp === "host" &&
                    promptDetails.promptName === "connect" &&
                    !urlParams.has("classic") &&
                    (loadGuestSession() || !hasImportedAccounts())
                ) {
                    const next = new URLSearchParams({
                        step: "account",
                        app: promptDetails.activeApp,
                        path: urlParams.get("returnPath") || "/",
                    });
                    window.location.replace(`/sign-in.html?${next}`);
                    return;
                }

                const iframeUrl = new URL(
                    siblingUrl(null, promptDetails.promptApp, null),
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
                const rootDomain =
                    activeApp !== "homepage"
                        ? new URL(siblingUrl(null, activeApp, returnPath))
                        : new URL(siblingUrl(null, null, returnPath));
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
        return (
            <div className="flex min-h-screen items-center justify-center">
                <ErrorCard
                    error={new Error(error)}
                    title="Error"
                    retryLabel="Go back"
                    retry={() => window.history.back()}
                />
            </div>
        );
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
                    allow="clipboard-read; clipboard-write"
                    style={{
                        width: "100%",
                        height: "100dvh",
                        border: "none",
                    }}
                />
            )}
        </div>
    );
};
