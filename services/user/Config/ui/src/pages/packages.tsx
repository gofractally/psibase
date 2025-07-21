/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { getPackageIndex, installPackages } from "@/lib/installPackages";

export const Packages = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [packageName, setPackageName] = useState<string>("");
    const [uploadStatus, setUploadStatus] = useState<string>("");

    const init = async () => {
        await getPackageIndex("root");
    };

    useEffect(() => {
        init();
    }, []);

    const doInstall: React.MouseEventHandler<HTMLButtonElement> = async (e) => {
        e.preventDefault();
        try {
            await installPackages("root", [packageName], "best", "current");
            setUploadStatus("");
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
            <form className="mx-auto grid max-w-screen-md grid-cols-6">
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="package" className="col-span-2">
                        Package
                    </Label>
                    <Input
                        id="package-name"
                        className="col-span-4"
                        onChange={(e) => {
                            setPackageName(e.target.value);
                            setChangesMade(true);
                        }}
                        value={packageName}
                    />
                </div>
                <div className="col-span-6 mt-6 font-medium">
                    <Button
                        type="submit"
                        disabled={!changesMade}
                        onClick={doInstall}
                    >
                        Install
                    </Button>
                </div>
            </form>
            {uploadStatus && <div>{uploadStatus}</div>}
        </div>
    );
};
