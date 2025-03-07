import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";

export const App = () => {
    // const [id, setId] = useState<string | null>(null);
    // const [returnUrlPath, setReturnUrlPath] = useState<string | null>(null);
    const [hasRequiredQueryParams, setHasRequiredQueryParams] =
        useState<boolean>(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    useEffect(() => {
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const idParam = urlParams.get("id");
        const returnUrlPathParam = urlParams.get("returnUrlPath");

        // setId(idParam);
        // setReturnUrlPath(returnUrlPathParam);

        console.log(
            "returnUrlPath specified? ",
            urlParams.has("returnUrlPath"),
        );
        console.log("returnUrlPath keys(): ", urlParams.keys());
        const requiredQueryParams =
            urlParams.has("id") && urlParams.has("returnUrlPath");
        setHasRequiredQueryParams(requiredQueryParams);
        if (requiredQueryParams) {
            // Set up the iframe URL
            const url =
                siblingUrl(null, "permissions", null, true) +
                "/permissions.html";
            console.log("Permissions URL: ", url);
            const newIframeUrl = new URL(url);
            newIframeUrl.searchParams.set("id", idParam || "");
            newIframeUrl.searchParams.set(
                "returnUrlPath",
                returnUrlPathParam || "",
            );

            setIframeUrl(newIframeUrl.toString());
        }
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
