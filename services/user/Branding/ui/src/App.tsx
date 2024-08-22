import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { Supervisor } from "@psibase/common-lib";

const supervisor = new Supervisor();

export const App = () => {
    const [chainName, setChainName] = useState<string>("");
    const [logo, setLogo] = useState<string>("");
    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const [res, setRes] = useState<string>("");
    const [queriedChainName, setQueriedChainName] = useState<string>("");

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
            console.info("ui: calling setLogo with arg:");
            console.info(
                logoBytes.length,
                "; ",
                logoBytes.slice(0, 10).toString(),
            );
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

    return (
        <>
            <div>Branding Page</div>
            <form>
                <Label htmlFor="chainName">Chain Name:</Label>
                <Input
                    id="chainName"
                    onChange={(e) => setChainName(e.target.value)}
                    value={chainName}
                />
                <Label htmlFor="logoPath">Logo:</Label>
                <Input
                    id="logoPath"
                    onChange={(e) => setLogo(e.target.value)}
                    value={logo}
                />
                <Input type="file" onChange={handleFileChange} />
                <Button type="submit" onClick={pushNewStuff}>
                    Save
                </Button>
            </form>
            <Button type="button" onClick={getChainName}>
                getChainName
            </Button>
        </>
    );
};
