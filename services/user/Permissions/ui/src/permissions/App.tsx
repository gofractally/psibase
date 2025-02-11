import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Checkbox } from "@shadcn/checkbox";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { useCreateConnectionToken } from "@hooks";

import { supervisor } from "./perms_main";

interface PermRequest {
    caller: string;
    callee: string;
    expiry_timestamp: number;
}

const PERM_REQUEST_TIMEOUT = 2 * 60;

export const App = () => {
    const thisServiceName = "Permissions";
    const [remember, setRemember] = useState<boolean>(true);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMsg, setErrorMsg] = useState<string>("");
    const [params, setParams] = useState<any>({});
    const [isValidPermRequest, setIsValidPermRequest] = useState<any>({});

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
        // Get query parameters as an object
        const qps = getQueryParams();
        console.info("info().qps: ", qps);
        setParams(qps);
        console.info("calling isValidRequest()");
        const isValidRequest = await supervisor.functionCall({
            service: "permissions",
            intf: "admin",
            method: "isValidRequest",
            params: [qps.caller, qps.callee],
        });
        console.info("isValidRequest:", isValidRequest);
        setIsValidPermRequest(isValidRequest);
        console.info("setting isLoading to false");
        setIsLoading(false);
    };

    useEffect(() => {
        init();
    }, []);

    const accept = async () => {
        try {
            let res = await supervisor.functionCall({
                service: "permissions",
                intf: "api",
                method: "savePermission",
                /* TODO: WORKAROUND: logs in as boot account (assuming "myproducer" as boot account). Update this with token actual login. */
                // params: ["myproducer"],
                params: [params.caller, params.callee, remember],
            });
        } catch (e) {
            console.error("error saving permission: ", e);
        }
        window.close();
    };
    const deny = () => {
        window.close();
    };
    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (!params.caller || !params.callee) {
        console.error("Malformed query params: ", window.location.href);
    }

    console.info("isValidPermRequest: ", isValidPermRequest);
    if (!isValidPermRequest) {
        console.error("Forged request detected.");
        setErrorMsg("Forged request detected.");
        return <div>Forged request detected.</div>;
    }
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Grant access?" />
            <p>
                {`"${params.caller}" is requesting full access to "${params.callee}".`}
            </p>
            <div className="flex items-center space-x-2">
                <Checkbox id="remember" checked={true} />
                <label
                    htmlFor="remember"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                    Remember this answer.
                </label>
            </div>
            <Button onClick={accept}>Accept</Button>
            <Button onClick={deny}>Deny</Button>
            {/* Clicking Accept/Deny calls savePermission() with user response, then closes window (to resolve the promise) --> */}
        </div>
    );
};
