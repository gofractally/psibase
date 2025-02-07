import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { useCreateConnectionToken } from "@hooks";

import { supervisor } from "./main";

export const App = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [permissions, setPermissions] = useState<string>("");
    const [uploadStatus, setUploadStatus] = useState<string>("");
    const thisServiceName = "Permissions";

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
    };

    useEffect(() => {
        init();
    }, []);

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Permissions Admin Page" />
            <form className="mx-auto grid max-w-screen-md grid-cols-6">
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="permissions" className="col-span-2">
                        Permissions Stored Locally
                    </Label>
                    <Input
                        id="permissions"
                        className="col-span-4"
                        onChange={(e) => {
                            setPermissions(e.target.value);
                            setChangesMade(true);
                        }}
                        value={permissions}
                    />
                </div>
            </form>
        </div>
    );
};
