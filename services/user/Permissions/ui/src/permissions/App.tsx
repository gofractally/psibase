import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";

import { supervisor } from "./perms_main";
import { siblingUrl } from "@psibase/common-lib";
import { OAUTH_REQUEST_KEY } from "@/constants";

export const App = () => {
    const thisServiceName = "permissions";
    const [permOauthReqId, setPermOauthReqId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [validPermRequest, setValidPermRequest] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isTopSupervisor, setIsTopSupervisor] = useState(false);
    const initApp = async () => {
        await supervisor.onLoaded();

        const qps = getQueryParams();
        setPermOauthReqId(qps.id);

        const permReqPayloadEnc = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY],
        });
        const permReqPayload = JSON.parse(
            new TextDecoder().decode(permReqPayloadEnc),
        );
        setValidPermRequest(permReqPayload);

        try {
            console.info("Determining isTopSupervisor:");
            console.info(window.top);
            const isTopSupervisor =
                window.top?.location.origin ==
                siblingUrl(null, "supervisor", null, true);
            console.info("isTopSupervisor:", isTopSupervisor);
            setIsTopSupervisor(isTopSupervisor);
        } catch (e) {
            // setError("Security error: unable to determine top origin.");
            console.error(
                "Security error: unable to determine if Supervisor is top.",
            );
            // setIsLoading(false);
            // return;
        }

        setIsLoading(false);
    };

    useEffect(() => {
        initApp();
    }, []);

    const followReturnRedirect = async () => {
        const qps = getQueryParams();
        let returnUrlPath = qps.returnUrlPath;
        if (
            !!returnUrlPath &&
            returnUrlPath.length > 0 &&
            !returnUrlPath.startsWith("/")
        )
            returnUrlPath = "/" + returnUrlPath;

        const url =
            siblingUrl(null, validPermRequest?.caller, null, true) +
            returnUrlPath;
        if (window.top) {
            window.top.location.href = url;
        }
    };

    const deletePermRequest = async () => {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "delete",
            params: [OAUTH_REQUEST_KEY],
        });
    };

    const approve = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "api",
                method: "savePermission",
                params: [validPermRequest?.caller, validPermRequest?.callee],
            });
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Unknown error saving permission");
            }
            console.error("error saving permission: ", e);
            throw e;
        }
        deletePermRequest();
        followReturnRedirect();
    };
    const deny = () => {
        deletePermRequest();
        followReturnRedirect();
    };
    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    if (error) {
        return <div>{error}</div>;
    } else if (isLoading) {
        return <div>Loading...</div>;
    } else {
        if (!validPermRequest) {
            console.error("Forged request detected.");
        }
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <h2 style={{ textAlign: "center" }}>Grant access?</h2>
            {!!validPermRequest ? (
                <>
                    <p>
                        {`"${validPermRequest.caller}" is requesting full access to "${validPermRequest.callee}".`}
                    </p>
                    {!!error && <div>ERROR: {error}</div>}
                    <div className="flex justify-center gap-4">
                        <Button onClick={approve}>Approve</Button>
                        <Button onClick={deny}>Deny</Button>
                    </div>
                </>
            ) : (
                <div>Forged request detected.</div>
            )}
        </div>
    );
};
