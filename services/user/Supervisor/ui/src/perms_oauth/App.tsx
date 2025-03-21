import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";
import {
    ActiveAccessRequest,
    isTypeValidPermissionRequest,
    ValidPermissionRequest,
} from "./db";

const buildIframeUrl = (perms_req: ValidPermissionRequest) => {
    // TODO: custom permission handling by an app needs to be part of this url construction
    // looks like it is, but I don't think this is working. I'll need to test/debug
    let subdomain = "permissions";
    let urlPath = "/permissions.html";
    if (perms_req.permsUrlPath) {
        subdomain = perms_req.payload.callee;
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
    return newIframeUrl.toString();
};

export const App = () => {
    const [hasRequiredQueryParams, setHasRequiredQueryParams] =
        useState<boolean>(false);
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const requiredQueryParams = urlParams.has("payload");
        setHasRequiredQueryParams(requiredQueryParams);
        const payload = urlParams.get("payload");
        if (!payload) {
            throw new Error("Access Request error: No payload provided");
        }
        const payloadObj = JSON.parse(decodeURIComponent(payload));

        if (requiredQueryParams) {
            // const idParam = urlParams.get("id");
            // if (!idParam) {
            //     throw new Error("Access Request error: No id provided");
            // }

            const perms_req_res = await ActiveAccessRequest.get(payloadObj.id);
            // TODO: is caller being gotten at the right time from the right place? ==> const senderApp = getSenderApp().app;
            if (isTypeValidPermissionRequest(perms_req_res)) {
                const perms_req = perms_req_res as ValidPermissionRequest;
                setIframeUrl(buildIframeUrl(perms_req));

                ActiveAccessRequest.delete();
            } else {
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
