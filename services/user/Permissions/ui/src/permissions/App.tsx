import { useState } from "react";

import { Button } from "@shadcn/button";

import { supervisor } from "./perms_main";
import { useQuery } from "@tanstack/react-query";

export const App = () => {
    console.info("Permissions::App.tsx...");
    const thisServiceName = "permissions";
    const [params, setParams] = useState<any>({});

    const {
        data: isValidPermRequest,
        isLoading,
        error,
    } = useQuery({
        queryKey: ["isValidPermRequest"],
        queryFn: async () => {
            console.log("isValidPermRequest.queryFn().top...");
            await supervisor.onLoaded();

            const qps = getQueryParams();
            setParams(qps);

            console.log("1.1 qps: ", qps);
            try {
                const isValidRequest = await supervisor.functionCall({
                    service: thisServiceName,
                    intf: "admin",
                    method: "isValidRequest",
                    params: [qps.id, qps.caller, qps.callee],
                });
                console.log("1.2 isValidRequest: ", isValidRequest);

                return isValidRequest;
            } catch (e) {
                console.error("1.4 error: ", e);
                return false;
            }
        },
    });

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
        console.log("accept().params.returnUrl: ", params.returnUrl);
        let retUrl = decodeURIComponent(params.returnUrl);
        console.log("accept().retUrl: ", retUrl);

        // Try multiple navigation methods
        try {
            // Method 1: Try window.top navigation
            console.log("Method 1");
            if (window.top) {
                window.top.location.href = retUrl;
            }
        } catch (e) {
            console.log("Top navigation failed, trying other methods...");
        }

        // try {
        //     console.log("Method 2");
        //     // Method 2: Try parent window navigation
        //     if (window.parent) {
        //         window.parent.location.href = retUrl;
        //     }
        // } catch (e) {
        //     console.log("Parent navigation failed, trying other methods...");
        // }

        // console.log("Method 3");
        // // Method 3: Fallback to window.location
        // window.location.href = retUrl;
    };
    const deny = () => {
        window.close();
    };
    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    // if (error) {
    //     return <div>Error...</div>;
    // }

    if (isLoading) {
        return <div>Loading...</div>;
    } else {
        // if (!isLoading) {
        if (!params.caller || !params.callee) {
            console.error("Malformed query params: ", window.location.href);
        }

        if (!isValidPermRequest) {
            console.error("Forged request detected.");
        }
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            {/* <Nav title="Grant access?" /> */}
            <h2 style={{ textAlign: "center" }}>Grant access?</h2>
            {<div>Params: {JSON.stringify(params)}</div>}
            {error && <div>Error: {JSON.stringify(error)}</div>}
            {<div>Loading: {isLoading ? "true" : "false"}</div>}
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
