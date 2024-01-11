import { useEffect, useRef, useState } from "react";
import { connect } from "@psibase/plugin";

const baseUrl = "https://token-sys.psibase.127.0.0.1.sslip.io:8080";

// npm run build && psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree r-account-sys / ./dist/ -S r-account-sys

export const useConnect = () => {
    const [supervisor, setSupervisor] = useState();
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;
        // @ts-ignore
        connect().then((x) => setSupervisor(x));
    }, []);

    return supervisor;
};
