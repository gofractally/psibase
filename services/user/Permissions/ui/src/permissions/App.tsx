import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Checkbox } from "@shadcn/checkbox";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { useCreateConnectionToken } from "@hooks";

import { supervisor } from "./perms_main";
import { CallTracker } from "assert";
import { CancelledError } from "@tanstack/react-query";
import { boolean } from "zod";

export const App = () => {
    const [permissions, setPermissions] = useState<string>("");
    const thisServiceName = "Permissions";
    const [remember, setRemember] = useState<boolean>(true);

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
    };

    useEffect(() => {
        init();
    }, []);

    const accept = async () => {
        // accept perms
        console.info("perms_index accept");
        try {
            let res = await supervisor.functionCall({
                service: "permissions",
                intf: "api",
                method: "savePermission",
                /* TODO: WORKAROUND: logs in as boot account (assuming "myproducer" as boot account). Update this with token actual login. */
                // params: ["myproducer"],
                params: [params.caller, params.callee, remember],
            });
            console.info("savePermissions() --> ", res);
        } catch (e) {
            console.error("error saving permission: ", e);
        }
        window.close();
    };
    const deny = () => {
        // deny perms
        console.info("perms_index deny");
        window.close();
    };
    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    // Get query parameters as an object
    const params = getQueryParams();
    if (!params.caller || !params.callee) {
        console.error("Malformed query params: ", window.location.href);
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
