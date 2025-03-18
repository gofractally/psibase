import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";
import { CurrentAccessRequest, ValidPermissionRequest } from "./db";
import { RecoverableErrorPayload } from "../plugin/errors";

export const App = () => {
    const [hasRequiredQueryParams, setHasRequiredQueryParams] =
        useState<boolean>(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const isValidPermissionRequestType = (
        perms_req_res: ValidPermissionRequest | RecoverableErrorPayload,
    ): perms_req_res is ValidPermissionRequest => {
        return (
            "id" in perms_req_res &&
            "payload" in perms_req_res &&
            "callee" in perms_req_res.payload &&
            "permsUrlPath" in perms_req_res &&
            "returnUrlPath" in perms_req_res
        );
    };

    const buildAndSetIframeUrl = (perms_req: ValidPermissionRequest) => {
        let subdomain = "permissions";
        let urlPath = "/permissions.html";
        if (perms_req.permsUrlPath) {
            subdomain = perms_req.payload.caller;
            urlPath = perms_req.permsUrlPath;
        }
        const url = siblingUrl(null, subdomain, null, true) + urlPath;
        const newIframeUrl = new URL(url);
        newIframeUrl.searchParams.set("id", perms_req.id);
        const urlParams = new URLSearchParams(window.location.search);
        const urlPayload = {
            ...perms_req.payload,
            returnUrlPath: urlParams.get("returnUrlPath"),
        };
        newIframeUrl.searchParams.set(
            "payload",
            encodeURIComponent(JSON.stringify(urlPayload)),
        );

        setIframeUrl(newIframeUrl.toString());
    };

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const idParam = urlParams.get("id");

        const requiredQueryParams = urlParams.has("id");
        setHasRequiredQueryParams(requiredQueryParams);
        if (requiredQueryParams) {
            // Set up the iframe URL
            if (!idParam) {
                throw new Error("Access Request error: No id provided");
            }
            const perms_req_res = await CurrentAccessRequest.get(idParam);

            // const senderApp = getSenderApp().app;
            if (isValidPermissionRequestType(perms_req_res)) {
                const perms_req = perms_req_res as ValidPermissionRequest;
                buildAndSetIframeUrl(perms_req);

                CurrentAccessRequest.delete();
            } else {
                // Handle the error case
                throw perms_req_res;
            }
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
