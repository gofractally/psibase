import { useState } from "react";

import { AppletId, query } from "common/rpc.mjs";
export interface MsgProps {
    addMsg: any;
    clearMsg: any;
}

export const fetchQuery = <T>(
    queryName: string,
    service: string,
    params: any = {},
    subPath: string = ""
): Promise<T> => {
    return new Promise<T>((resolve) => {
        query(new AppletId(service, subPath), queryName, params);
    });
};

export const getLoggedInUser = async (): Promise<string> => {
    const t: string = await query<any, string>(
        new AppletId("account-sys", ""),
        "getLoggedInUser"
    );
    return t;
};

export const useMsg = () => {
    const [msg, setMsg] = useState("");

    const clearMsg = () => {
        setMsg("");
    };

    const addMsg = (msg: any) => {
        setMsg((prevMsg: any) => prevMsg + msg + "\n");
    };

    return { msg, addMsg, clearMsg };
};
