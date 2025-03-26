import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";
import { ActiveOauthRequest, isTypeOauthRequest, OauthRequest } from "./db";

const buildIframeUrl = (promptUserReq: OauthRequest) => {
    const urlParams = new URLSearchParams(window.location.search);
    const url =
        siblingUrl(null, promptUserReq.subdomain, null, true) +
        promptUserReq.subpath;
    const newIframeUrl = new URL(url);
    newIframeUrl.searchParams.set("id", promptUserReq.id);
    newIframeUrl.searchParams.set(
        "returnUrlPath",
        urlParams.get("returnUrlPath") || "",
    );
    return newIframeUrl.toString();
};

export const App = () => {
    const [hasRequiredQueryParams, setHasRequiredQueryParams] =
        useState<boolean>(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const requiredQueryParams = urlParams.has("id");
        setHasRequiredQueryParams(requiredQueryParams);
        const oauth_id = urlParams.get("id");
        if (!oauth_id) {
            throw new Error("Access Request error: No id provided");
        }

        if (requiredQueryParams) {
            const oauthReq = await ActiveOauthRequest.get(oauth_id);
            if (isTypeOauthRequest(oauthReq)) {
                setIframeUrl(buildIframeUrl(oauthReq as OauthRequest));

                ActiveOauthRequest.delete();
            } else {
                console.error("Invalid oauth request payload");
            }
        }
    };

    useEffect(() => {
        initApp();
    }, []);

    return (
        <>
            {!hasRequiredQueryParams ? (
                <div>ERROR: No payload provided</div>
            ) : (
                <div
                    style={{
                        width: "100%",
                        height: "100vh",
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
                                height: "50vh",
                                border: "none",
                            }}
                        />
                    )}
                </div>
            )}
        </>
    );
};
