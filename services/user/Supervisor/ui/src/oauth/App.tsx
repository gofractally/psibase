import { useEffect, useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { ActiveOauthRequest, OauthRequest, zOauthRequest } from "./db";

const buildIframeUrl = (promptUserReq: OauthRequest) => {
    const urlParams = new URLSearchParams(window.location.search);
    const url = siblingUrl(
        null,
        promptUserReq.subdomain,
        promptUserReq.subpath,
        true,
    );
    const newIframeUrl = new URL(url);
    newIframeUrl.searchParams.set("id", promptUserReq.id);
    newIframeUrl.searchParams.set(
        "returnUrlPath",
        urlParams.get("returnUrlPath") || "",
    );
    return newIframeUrl.toString();
};

export const App = () => {
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const oauth_id = urlParams.get("id");
        if (!oauth_id) {
            setError("OAuth request error: No id provided");
            return;
        }

        try {
            const oauthReqUnchecked = await ActiveOauthRequest.get(oauth_id);
            const oauthReq = zOauthRequest.parse(oauthReqUnchecked);
            setIframeUrl(buildIframeUrl(oauthReq));
            await ActiveOauthRequest.delete();
        } catch (e) {
            setError("OAuth request error: " + e);
        }
    };

    useEffect(() => {
        initApp();
    }, []);

    if (!!error) {
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
