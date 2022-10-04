import {
    AppletId,
    getJson,
    query,
    siblingUrl,
    setActiveAccount,
} from "common/rpc.mjs";
import { AccountWithAuth } from "./App";
export interface MsgProps {
    addMsg: any;
    clearMsg: any;
    isLoading: boolean;
    onAccountCreation: (account: {
        publicKey: string;
        privateKey: string;
        account: string;
    }) => void;
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
    return query<any, string>(
        new AppletId("account-sys", ""),
        "getLoggedInUser"
    );
};

export const updateAccountInCommonNav = (account: string) => {
    setActiveAccount(account);
};

export const fetchAccountsByKey = async (publicKey: string) => {
    if (!publicKey) throw new Error(`No public key found ${publicKey}`);
    return getJson<{ account: string; pubkey: string }[]>(
        await siblingUrl(null, "auth-ec-sys", "accwithkey/" + publicKey)
    );
};

export const fetchAccounts = async () => {
    try {
        const accounts = await getJson<AccountWithAuth[]>("/accounts");
        return accounts;
    } catch (e) {
        console.info("refreshAccounts().catch().e:");
        console.info(e);
        return [];
    }
};
