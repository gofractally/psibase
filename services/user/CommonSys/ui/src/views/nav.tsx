import { useEffect, useState } from "react";

import { siblingUrl as getSiblingUrl } from "common/rpc.mjs";

import Ninebox from "../images/ninebox.svg";
import PsibaseLogo from "../images/psibase.svg";
import { Button } from "../components";
import wait from "waait";

export const Nav = ({ currentUser }: { currentUser: string }) => {
    const [commonSysUrl, setCommonSysUrl] = useState("");
    const [isMockLoading, setIsMockLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setCommonSysUrl(await getSiblingUrl());
        })();
    }, []);

    useEffect(() => {
        (async () => {
            await wait(5000);
            setIsMockLoading(false);
        })();
    }, []);

    return (
        <header className="flex items-center justify-between p-2 sm:px-8">
            <a href={commonSysUrl}>
                <PsibaseLogo />
            </a>
            <div className="flex items-center gap-5">
                <a href={commonSysUrl}>
                    <Ninebox />
                </a>
                {currentUser ? (
                    <div className="flex h-10 w-10 select-none items-center justify-center rounded-full bg-gray-500 text-white">
                        <span className="text-3xl font-bold">
                            {(currentUser[0] ?? "").toUpperCase()}
                        </span>
                    </div>
                ) : (
                    <Button
                        href="/applet/account-sys"
                        type="secondary"
                        isLoading={isMockLoading}
                    >
                        Sign In
                    </Button>
                )}
            </div>
        </header>
    );
};

export default Nav;
