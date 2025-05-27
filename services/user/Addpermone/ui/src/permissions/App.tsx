import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";

import { Nav } from "@components/nav";

import { supervisor } from "./main";

export const App = () => {
    const thisServiceName = "addpermone";
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [params, setParams] = useState<any>({});
    const [isValidPermRequest, setIsValidPermRequest] = useState<any>({});

    const init = async () => {
        await supervisor.onLoaded();

        const qps = getQueryParams();
        setParams(qps);

        const isValidRequest = await supervisor.functionCall({
            service: thisServiceName,
            intf: "admin",
            method: "isValidRequest",
            params: [qps.caller, qps.callee],
        });
        setIsValidPermRequest(isValidRequest);

        setIsLoading(false);
    };

    useEffect(() => {
        init();
    }, []);

    const accept = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "savePerm",
                params: [params.caller, params.method],
            });
        } catch (e) {
            console.error("error saving permission: ", e);
        }
        window.close();
    };
    const deny = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "delPerm",
                params: [params.caller, params.method],
            });
        } catch (e) {
            console.error("error deleting permission: ", e);
        }
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
        return <div>Forged request detected.</div>;
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Grant access?" />
            <p>{params.prompt}</p>
            <Button onClick={accept}>Accept</Button>
            <Button onClick={deny}>Deny</Button>
        </div>
    );
};
