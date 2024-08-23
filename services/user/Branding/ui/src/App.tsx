import { useEffect, useRef, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { siblingUrl, Supervisor } from "@psibase/common-lib";
import { Nav } from "@components/nav";

const supervisor = new Supervisor();

export const App = () => {
    const [chainName, setChainName] = useState<string>("");
    const [logo, setLogo] = useState<string>("");
    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const [res, setRes] = useState<string>("");
    const [queriedChainName, setQueriedChainName] = useState<string>("");
    const fileInput = useRef<HTMLInputElement>(null);

    const init = async () => {
        await supervisor.onLoaded();
        supervisor.preLoadPlugins([{ service: "branding" }]);
    };

    useEffect(() => {
        init();
    }, []);

    const getChainName: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        const queriedChainName = (await supervisor.functionCall({
            service: "branding",
            intf: "queries",
            method: "getChainName",
            params: [],
        })) as string;
        setQueriedChainName(queriedChainName);
        setChainName(queriedChainName);
    };
    const pushNewStuff: React.MouseEventHandler<HTMLButtonElement> = async (
        e,
    ) => {
        e.preventDefault();
        try {
            // console.info("ui: calling setLogo with arg:");
            // console.info(
            //     logoBytes.length,
            //     "; ",
            //     logoBytes.slice(0, 10).toString(),
            // );
            let res = await supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "loginTemp",
                params: ["branding"],
            });

            // console.info("ui:chainName: ", chainName);
            if (chainName) {
                res = await supervisor.functionCall({
                    service: "branding",
                    intf: "api",
                    method: "setChainName",
                    params: [chainName],
                });
            }

            res = await supervisor.functionCall({
                service: "branding",
                intf: "api",
                method: "setLogo",
                params: [logoBytes],
            });
            setRes(res as string);
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
            // Convert the byte data to hexadecimal string
            const hexString: string = Array.from(bytes)
                .map((x) => x.toString(16).padStart(2, "0"))
                .join("");

            // const readerResult = reader.result?.toString() || "";
            // const buffer = Buffer.from(readerResult, "hex");
            // const encodedHexString = buffer.toString("base64");
            // console.info("ui: hexString:", hexString);
            setLogo(hexString);
        };
        reader.readAsArrayBuffer(file);
    };

    const openFileClick = () => {
        if (!fileInput.current) return;
        fileInput.current.click();
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Branding Page" />
            <form>
                <div className="mt-6 font-medium">
                    <Label htmlFor="chainName">Chain Name</Label>
                    <Input
                        id="chainName"
                        onChange={(e) => setChainName(e.target.value)}
                        value={chainName}
                    />
                </div>
                <div className="mt-6 font-medium">
                    <Label htmlFor="logoPath">Logo</Label>
                    <div>
                        <img
                            src={siblingUrl(
                                null,
                                "branding",
                                "/chain_logo.svg",
                            )}
                            className="b-1 h-24 w-24 border-solid border-gray-200"
                            onClick={openFileClick}
                        />
                        <Input
                            id="logoPath"
                            onChange={(e) => setLogo(e.target.value)}
                            value={logo}
                        />
                    </div>
                    <div>Size: 96px x 96px</div>

                    <Input
                        id="logo-file"
                        type="file"
                        className="invisible"
                        onChange={handleFileChange}
                        ref={fileInput}
                    />
                </div>
                <div className="mt-6 font-medium">
                    <Button type="submit" onClick={pushNewStuff}>
                        Save
                    </Button>
                </div>
            </form>
            <Button type="button" onClick={getChainName}>
                getChainName
            </Button>
        </div>
    );
};
