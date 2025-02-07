import { useEffect } from "react";

import { Label } from "@shadcn/label";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import { supervisor } from "./main";

export const App = () => {
    const thisServiceName = "Permissions";

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
                        Permissions Admin
                    </Label>
                </div>
            </form>
        </div>
    );
};
