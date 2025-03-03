import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Checkbox } from "@shadcn/checkbox";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { supervisor } from "./perms_main";

export const App = () => {
    const thisServiceName = "permissions";
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [params, setParams] = useState<any>({});
    const [isValidPermRequest, setIsValidPermRequest] = useState<any>({});

    const init = async () => {
        await supervisor.onLoaded();

        const qps = getQueryParams();
        setParams(qps);

        try {
            const isValidRequest = await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "isValidRequest",
                params: [qps.caller, qps.callee],
            });
            setIsValidPermRequest(isValidRequest);
        } catch (e) {
            console.error(e);
        }

        setIsLoading(false);
    };

    useEffect(() => {
        init();
    }, []);

    const accept = async () => {
        try {
            let res = await supervisor.functionCall({
                service: thisServiceName,
                intf: "api",
                method: "savePermission",
                params: [params.caller, params.callee],
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

    if (!isValidPermRequest) {
        console.error("Forged request detected.");
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Grant access?" />
            {isValidPermRequest ? (
                <p>
                    {`"${params.caller}" is requesting full access to "${params.callee}".`}
                </p>
            ) : (
                <div>Forged request detected.</div>
            )}
            <Button onClick={accept}>Accept</Button>
            <Button onClick={deny}>Deny</Button>
        </div>
    );
};
