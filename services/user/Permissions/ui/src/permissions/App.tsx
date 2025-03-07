import { useState } from "react";

import { Button } from "@shadcn/button";

import { supervisor } from "./perms_main";
import { useQuery } from "@tanstack/react-query";
import { siblingUrl } from "@psibase/common-lib";

export const App = () => {
    const thisServiceName = "permissions";
    const [params, setParams] = useState<any>({});

    const {
        data: validPermRequest,
        isLoading,
        error,
    } = useQuery({
        queryKey: ["validPermRequest"],
        queryFn: async () => {
            await supervisor.onLoaded();

            const qps = getQueryParams();
            setParams(qps);

            try {
                // translate id to caller/callee
                const validRequest = await supervisor.functionCall({
                    service: thisServiceName,
                    intf: "admin",
                    method: "getValidPermRequest",
                    params: [qps.id],
                });
                console.info("perm ui.validRequest: ", validRequest);

                return validRequest;
            } catch (e) {
                console.error("Error: ", e);
                return {};
            }
        },
    });

    const followReturnRedirect = async () => {
        let retUrl = decodeURIComponent(params.returnUrlPath);

        try {
            // Method 1: Try window.top navigation

            const url =
                siblingUrl(null, validPermRequest.caller, null, true) +
                "/" +
                retUrl;
            console.log("followReturnRedirect().retUrl: ", url);
            if (window.top) {
                window.top.location.href = url;
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
    };

    const accept = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "api",
                method: "savePermission",
                params: [validPermRequest.caller, validPermRequest.callee],
            });
        } catch (e) {
            console.error("error saving permission: ", e);
        }
        followReturnRedirect();
    };
    const deny = () => {
        followReturnRedirect();
    };
    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    if (isLoading) {
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
                <p>
                    {`"${validPermRequest.caller}" is requesting full access to "${validPermRequest.callee}".`}
                </p>
            ) : (
                <div>Forged request detected.</div>
            )}
            <Button onClick={accept}>Accept</Button>
            <Button onClick={deny}>Deny</Button>
        </div>
    );
};
