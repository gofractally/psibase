import {
    AppletId,
    getJson,
    query,
    setActiveAccount,
} from "@psibase/common-lib";
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
): Promise<T> => query(new AppletId(service, subPath), queryName, params);

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
    const accKeys = await fetchQuery<{ account: string; pubkey: string }[]>(
        "accWithKey",
        "auth-sys",
        {
            key: publicKey,
        }
    );
    if (publicKey.startsWith("PUB_")) {
        const accEcKeys = await fetchQuery<{ account: string; pubkey: string }[]>(
            "accWithKey",
            "auth-ec-sys",
            {
                key: publicKey,
            }
        );
        return accKeys.concat(accEcKeys);
    } else {
        return accKeys;
    }
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
