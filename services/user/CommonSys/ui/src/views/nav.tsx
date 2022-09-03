import { useEffect, useState } from "react";

import { siblingUrl as getSiblingUrl } from "common/rpc.mjs";

import ninebox from "../images/ninebox.svg";
import psibaseLogo from "../images/psibase.svg";

export const Nav = ({ currentUser }: { currentUser: string }) => {
    const [commonSysUrl, setCommonSysUrl] = useState("");

    useEffect(() => {
        (async () => {
            setCommonSysUrl(await getSiblingUrl());
        })();
    }, []);

    return (
        <header className="flex items-center justify-between p-2 sm:px-8">
            <a href={commonSysUrl}>
                <img src={psibaseLogo} />
            </a>
            <div className="flex items-center gap-5">
                <a href={commonSysUrl}>
                    <img src={ninebox} />
                </a>
                <div className="flex h-10 w-10 select-none items-center justify-center rounded-full bg-gray-500 text-white">
                    <span className="text-3xl font-bold">
                        {(currentUser?.[0] ?? "").toUpperCase()}
                    </span>
                </div>
            </div>
        </header>
    );
};

export default Nav;
