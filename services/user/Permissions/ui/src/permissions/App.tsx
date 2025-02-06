import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Checkbox } from "@shadcn/checkbox";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { useCreateConnectionToken } from "@hooks";

import { supervisor } from "./perms_main";

export const App = () => {
    const [permissions, setPermissions] = useState<string>("");
    const thisServiceName = "Permissions";

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
    };

    useEffect(() => {
        init();
    }, []);

    const app1 = "App #1";
    const app2 = "App #2";
    const accept = () => {
        // accept perms
        console.info("perms_index accept");
    };
    const deny = () => {
        // deny perms
        console.info("perms_index deny");
    };
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Permissions Admin Page" />
            <p>
                {app1} is requesting full access to {app2}.
            </p>
            <div className="flex items-center space-x-2">
                <Checkbox id="remember" />
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
