import { useEffect, useState } from "react";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

import { ActivePermsOauthRequest, type PermsOauthRequest } from "./db";

const supervisor = getSupervisor();

export const App = () => {
    const thisServiceName = "permissions";
    const [isLoading, setIsLoading] = useState(true);
    const [validPermRequest, setValidPermRequest] =
        useState<PermsOauthRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const initApp = async () => {
        let permReqPayload;
        try {
            permReqPayload = await ActivePermsOauthRequest.get();
        } catch (e) {
            setError("Permissions request error: " + e);
            setIsLoading(false);
            return;
        }

        const qps = getQueryParams();
        if (qps.id && qps.id != permReqPayload.id) {
            setError("Forged request detected.");
            setIsLoading(false);
            return;
        }

        if (
            !permReqPayload.user ||
            !permReqPayload.caller ||
            !permReqPayload.callee
        ) {
            setError("Invalid permissions request payload: missing fields.");
            setIsLoading(false);
            return;
        }

        setValidPermRequest(permReqPayload);
        setIsLoading(false);
    };

    useEffect(() => {
        initApp();
    }, []);

    const followReturnRedirect = async () => {
        const qps = getQueryParams();
        if (window.top) {
            window.top.location.href = siblingUrl(
                null,
                validPermRequest?.caller,
                qps.returnUrlPath,
                true,
            );
        }
    };

    const approve = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "savePerm",
                params: [
                    validPermRequest?.user,
                    validPermRequest?.caller,
                    validPermRequest?.callee,
                ],
            });
            await ActivePermsOauthRequest.delete();
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Unknown error saving permission");
            }
            throw e;
        }
        followReturnRedirect();
    };
    const deny = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "delPerm",
                params: [
                    validPermRequest?.user,
                    validPermRequest?.caller,
                    validPermRequest?.callee,
                ],
            });
            await ActivePermsOauthRequest.delete();
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Unknown error deleting permission");
            }
            throw e;
        }
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
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <h2 style={{ textAlign: "center" }}>Grant access?</h2>
            <p>
                {`"${validPermRequest?.caller}" is requesting full access to "${validPermRequest?.callee}".`}
            </p>
            {!!error && <div>ERROR: {error}</div>}
            <div className="flex justify-center gap-4">
                <Button onClick={approve}>Approve</Button>
                <Button onClick={deny}>Deny</Button>
            </div>
        </div>
    );
};
