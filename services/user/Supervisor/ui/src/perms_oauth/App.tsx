import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";
import { CurrentAccessRequest } from "../db";

export const App = () => {
    const [hasRequiredQueryParams, setHasRequiredQueryParams] =
        useState<boolean>(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const initApp = async () => {
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const idParam = urlParams.get("id");
        const returnUrlPathParam = urlParams.get("returnUrlPath");

        const requiredQueryParams =
            urlParams.has("id") && urlParams.has("returnUrlPath");
        setHasRequiredQueryParams(requiredQueryParams);
        if (requiredQueryParams) {
            // Set up the iframe URL
            if (!idParam) {
                throw new Error("Access Request error: No id provided");
            }
            const perms_req = await CurrentAccessRequest.get(idParam);
            console.error("Unused perms_req:", perms_req);
            const url =
                siblingUrl(null, "permissions", null, true) +
                "/permissions.html";
            const newIframeUrl = new URL(url);
            newIframeUrl.searchParams.set("id", idParam || "");
            newIframeUrl.searchParams.set(
                "returnUrlPath",
                returnUrlPathParam || "",
            );

            setIframeUrl(newIframeUrl.toString());
        }
    };
    useEffect(() => {
        initApp();
    }, []);

    return (
        <>
            {!hasRequiredQueryParams ? (
                <div>Invalid URL parameters</div>
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
