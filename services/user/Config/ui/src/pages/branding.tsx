import { useEffect, useRef, useState } from "react";

import { supervisor } from "@/supervisor";
import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Branding = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [networkName, setNetworkName] = useState<string>("");
    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const fileInput = useRef<HTMLInputElement>(null);
    const [previewImgUrl, setPreviewImgUrl] = useState<string>("");
    const [uploadStatus, setUploadStatus] = useState<string>("");

    useEffect(() => {
        const init = async () => {
            await supervisor.onLoaded();
            await getNetworkName();
        };

        init();
    }, []);

    const getNetworkName = async () => {
        const queriedNetworkName = (await supervisor.functionCall({
            service: "branding",
            intf: "queries",
            method: "getNetworkName",
            params: [],
        })) as string;
        setNetworkName(queriedNetworkName);
    };
    const updateAssets: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        e.preventDefault();
        try {
            if (networkName) {
                await supervisor.functionCall({
                    service: "branding",
                    intf: "api",
                    method: "setNetworkName",
                    params: [networkName],
                });
            }

            if (logoBytes.length) {
                await supervisor.functionCall({
                    service: "branding",
                    intf: "api",
                    method: "setLogo",
                    params: [logoBytes],
                });
            }

            setUploadStatus("Successful");
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

    const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (
        event,
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.type != "image/svg+xml") {
            alert("Only SVGs are supported.");
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            if (!reader.result) {
                console.error("no image selected");
                return;
            }
            const bytes = new Uint8Array(reader.result as ArrayBuffer);
            setLogoBytes(bytes);
        };
        reader.readAsArrayBuffer(file);

        const reader2 = new FileReader();
        reader2.onload = () => {
            if (!reader2.result) {
                console.error("no image selected");
                return;
            }
            setPreviewImgUrl(reader2.result as string);
        };
        reader2.readAsDataURL(file);

        setChangesMade(true);
    };

    const openFileClick = () => {
        if (!fileInput.current) return;
        fileInput.current.click();
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <form className="mx-auto grid grid-cols-6">
                <div
                    className={
                        uploadStatus === "Successful"
                            ? "text-green-500"
                            : "text-red-500"
                    }
                >
                    {uploadStatus}
                </div>
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <div className="col-span-2">
                        <Label htmlFor="logoPath" className="block h-24 w-24">
                            Logo
                        </Label>
                        <div className="text-extralight text-sm">
                            Size: 96x96 px
                        </div>
                    </div>
                    <div className="col-span-2">
                        <img
                            src={siblingUrl(
                                null,
                                "branding",
                                "/network_logo.svg",
                            )}
                            height="96"
                            width="96"
                            className="b-1 col-span-3 h-24 w-24 object-cover"
                            onClick={openFileClick}
                        />
                        <div className="text-extralight text-sm">
                            Click logo to replace.
                        </div>
                    </div>
                    <div
                        className={
                            "col-span-2" +
                            (previewImgUrl.length ? "" : " invisible")
                        }
                    >
                        <img
                            src={previewImgUrl}
                            height="96"
                            width="96"
                            className="block h-24 w-24 object-cover"
                        />
                        <div className="text-extralight align-bottom text-sm">
                            Preview
                        </div>
                    </div>

                    <Input
                        id="logo-file"
                        type="file"
                        accept=".svg"
                        className="invisible absolute"
                        onChange={handleFileChange}
                        ref={fileInput}
                    />
                </div>
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="networkName" className="col-span-2">
                        Network name
                    </Label>
                    <Input
                        id="networkName"
                        className="col-span-4"
                        onChange={(e) => {
                            setNetworkName(e.target.value);
                            setChangesMade(true);
                        }}
                        value={networkName}
                    />
                </div>
                <div className="relative col-span-6 mt-6 font-medium">
                    <Button
                        type="submit"
                        className="absolute right-0"
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
