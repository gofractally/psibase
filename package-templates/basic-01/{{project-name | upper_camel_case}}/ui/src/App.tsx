import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl } from "@psibase/common-lib";
import { Nav } from "@components/nav";

import {
    useCreateConnectionToken,
} from "@hooks";

import { supervisor } from "./main";

export const App = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [exampleThing, setExampleThing] = useState<string>("");
    const [uploadStatus, setUploadStatus] = useState<string>("");
    const thisServiceName = "{{project-name}}"

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const init = async () => {
        await supervisor.onLoaded();
        await getExampleThing();
    };

    useEffect(() => {
        init();
    }, []);

    const getExampleThing = async () => {
        const queriedExampleThing = (await supervisor.functionCall({
            service: thisServiceName,
            intf: "queries",
            method: "getExampleThing",
            params: [],
        })) as string;
        setExampleThing(queriedExampleThing);
    };
    const updateAssets: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        e.preventDefault();
        try {
            await supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "login",
                /* TODO: WORKAROUND: logs in as boot account (assuming "myproducer" as boot account). Update this with token actual login. */
                params: ["myproducer"],
            });

            if (exampleThing) {
                await supervisor.functionCall({
                    service: thisServiceName,
                    intf: "api",
                    method: "setExampleThing",
                    params: [exampleThing],
                });
            }
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
                        Example Thing
                    </Label>
                    <Input
                        id="exampleThing"
                        className="col-span-4"
                        onChange={(e) => {
                            setExampleThing(e.target.value);
                            setChangesMade(true);
                        }}
                        value={exampleThing}
                    />
                </div>
                <div className="col-span-6 mt-6 font-medium">
                    <Button
                        type="submit"
                        disabled={!changesMade}
                        onClick={updateAssets}
                    >
                        Save
                    </Button>
                </div>
            </form>
        </div>
    );
};
