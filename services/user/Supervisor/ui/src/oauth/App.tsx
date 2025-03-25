import { useState, useEffect } from "react";
import { siblingUrl } from "@psibase/common-lib";
import {
    ActiveAccessRequest,
    isTypeValidPermissionRequest,
    ValidPermissionRequest,
} from "./db";

const buildIframeUrl = (promptUserReq: ValidPermissionRequest) => {
    const urlParams = new URLSearchParams(window.location.search);
    // TODO: custom permission handling by an app needs to be part of this url construction
    // looks like it is, but I don't think this is working. I'll need to test/debug
    // TODO: this default path should move to Permissions call of promptUser()
    // let subdomain = "permissions";
    // let urlPath = "/oauth.html";
    // if (promptUserReq.subpath) {
    // subdomain = promptUserReq.subdomain;
    // urlPath = promptUserReq.subpath;
    // }
    const url =
        siblingUrl(null, promptUserReq.subdomain, null, true) +
        promptUserReq.subpath;
    const newIframeUrl = new URL(url);
    newIframeUrl.searchParams.set("id", promptUserReq.id);
    newIframeUrl.searchParams.set(
        "returnUrlPath",
        urlParams.get("returnUrlPath") || "",
    );
    // const urlParams = new URLSearchParams(window.location.search);
    // const urlPayload = {
    //     ...promptUserReq.payload,
    //     returnUrlPath: urlParams.get("returnUrlPath"),
    // };
    // // TODO: this all should come from localstorage accessed by `id`
    // newIframeUrl.searchParams.set(
    //     "payload",
    //     encodeURIComponent(JSON.stringify(urlPayload)),
    // );
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
        // const payloadObj = JSON.parse(decodeURIComponent(payload));

        if (requiredQueryParams) {
            // const idParam = urlParams.get("id");
            // if (!idParam) {
            //     throw new Error("Access Request error: No id provided");
            // }

            const perms_req_res = await ActiveAccessRequest.get(oauth_id);
            // TODO: is caller being gotten at the right time from the right place? ==> const senderApp = getSenderApp().app;
            if (isTypeValidPermissionRequest(perms_req_res)) {
                const promptUserReq = perms_req_res as ValidPermissionRequest;
                setIframeUrl(buildIframeUrl(promptUserReq));

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
