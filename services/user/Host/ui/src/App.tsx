import { useEffect, useState } from "react";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

export const App = () => {
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const prompt_id = urlParams.get("id");
        if (!prompt_id) {
            setError("User prompt request error: No id provided");
            return;
        }
        const returnPath = urlParams.get("returnUrlPath") || "/";

        try {
            const res = await supervisor.functionCall({
                service: "host",
                plugin: "prompt",
                intf: "api",
                method: "get-prompt-url",
                params: [prompt_id, returnPath],
            });
            console.log(res);

            setIframeUrl(""); // todo - res
        } catch (e) {
            setError("Prompt error: " + e);
        }
    };

    useEffect(() => {
        initApp();
    }, []);

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
            Host page
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
