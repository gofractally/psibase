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
            const payload = JSON.parse(decodeURIComponent(qps.payload));
            setParams(qps);

            return payload;
        },
    });

    const followReturnRedirect = async () => {
        let retUrl = validPermRequest?.returnUrlPath;

        const redirectPath = retUrl ? "/" + retUrl : "";
        const url =
            siblingUrl(null, validPermRequest?.caller, null, true) +
            redirectPath;
        if (window.top) {
            window.top.location.href = url;
        }
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
                <>
                    <p>
                        {`"${validPermRequest.caller}" is requesting full access to "${validPermRequest.callee}".`}
                    </p>
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
