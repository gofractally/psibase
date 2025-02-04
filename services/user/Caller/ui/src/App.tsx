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
    const [uploadStatus, setUploadStatus] = useState<string>("");
    const thisServiceName = "caller";

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
    };

    useEffect(() => {
        init();
    }, []);

    const getPrivateData: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        e.preventDefault();
        try {
            let res = await supervisor.functionCall({
                service: "callee",
                intf: "queries",
                method: "getPrivateData",
                /* TODO: WORKAROUND: logs in as boot account (assuming "myproducer" as boot account). Update this with token actual login. */
                // params: ["myproducer"],
                params: [],
            });
            console.info("getPrivateData() --> ", res);
            setChangesMade(false);
        } catch (e) {
            if (e instanceof Error) {
                console.error(`Error: ${e.message}\nStack: ${e.stack}`);
                setUploadStatus(`Error: ${e.message}`);
            } else {
                console.error(
                    `Caught exception: ${JSON.stringify(e, null, 2)}`,
                );
                setUploadStatus(
                    `Caught exception: ${JSON.stringify(e, null, 2)}`,
                );
            }
        }
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Example Thing Page" />
            <form className="mx-auto grid max-w-screen-md grid-cols-6">
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="exampleThing" className="col-span-2">
                        Plugin Caller
                    </Label>
                </div>
                <div className="col-span-6 mt-6 font-medium">
                    <Button type="submit" onClick={getPrivateData}>
                        Request private data
                    </Button>
                </div>
            </form>
        </div>
    );
};
