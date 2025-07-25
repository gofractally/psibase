import { useEffect, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Input } from "@shared/shadcn/ui/input";

import { Nav } from "@/components/nav";

import { getSupervisor } from "@psibase/common-lib";
const supervisor = getSupervisor();

export const App = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [exampleThing, setExampleThing] = useState<string>("");
    const [, setUploadStatus] = useState<string>("");
    const thisServiceName = "{{project-name}}"

    useEffect(() => {
        const init = async () => {
            await supervisor.onLoaded();
            await getExampleThing();
        };
        
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
