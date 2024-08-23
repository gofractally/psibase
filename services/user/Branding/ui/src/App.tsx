import { useEffect, useRef, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl, Supervisor } from "@psibase/common-lib";
import { Nav } from "@components/nav";

const supervisor = new Supervisor();

export const App = () => {
    const [changesMade, setChangesMade] = useState<boolean>(false);
    const [chainName, setChainName] = useState<string>("");
    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const fileInput = useRef<HTMLInputElement>(null);

    const init = async () => {
        await supervisor.onLoaded();
        supervisor.preLoadPlugins([{ service: "branding" }]);
        setTimeout(getChainName, 1000);
    };

    useEffect(() => {
        init();
    }, []);

    const getChainName = async () => {
        const queriedChainName = (await supervisor.functionCall({
            service: "branding",
            intf: "queries",
            method: "getChainName",
            params: [],
        })) as string;
        console.info("ui: queried chain and got name:", queriedChainName);
        setChainName(queriedChainName);
    };
    const updateAssets: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        e.preventDefault();
        try {
            let res = await supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "loginTemp",
                params: ["branding"],
            });

            if (chainName) {
                res = await supervisor.functionCall({
                    service: "branding",
                    intf: "api",
                    method: "setChainName",
                    params: [chainName],
                });
            }

            if (logoBytes.length) {
                res = await supervisor.functionCall({
                    service: "branding",
                    intf: "api",
                    method: "setLogo",
                    params: [logoBytes],
                });
            }
        } catch (e) {
            if (e instanceof Error) {
                console.error(`Error: ${e.message}\nStack: ${e.stack}`);
            } else {
                console.error(
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
        setChangesMade(true);
    };

    const openFileClick = () => {
        if (!fileInput.current) return;
        fileInput.current.click();
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Chain Branding Page" />
            <form className="mx-auto grid max-w-screen-md grid-cols-6">
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <div className="col-span-2">
                        <Label htmlFor="logoPath">Logo</Label>
                        <div>Size: 96px x 96px</div>
                    </div>
                    <div className="col-span-4">
                        <img
                            src={siblingUrl(
                                null,
                                "branding",
                                "/chain_logo.svg",
                            )}
                            className="b-1 col-span-3 h-24 w-24 border-solid border-gray-200"
                            onClick={openFileClick}
                        />
                        <div className="text-extralight text-sm">
                            Click logo to replace.
                        </div>
                    </div>

                    <Input
                        id="logo-file"
                        type="file"
                        className="invisible absolute"
                        onChange={handleFileChange}
                        ref={fileInput}
                    />
                </div>
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="chainName" className="col-span-2">
                        Chain name
                    </Label>
                    <Input
                        id="chainName"
                        className="col-span-4"
                        onChange={(e) => {
                            setChainName(e.target.value);
                            setChangesMade(true);
                        }}
                        value={chainName}
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
