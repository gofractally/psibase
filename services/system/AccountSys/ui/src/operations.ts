import { AppletId, getJson, operationWithTrxReceipt } from "common/rpc.mjs";

import { AccountWithAuth, AccountWithKey } from "./App";
import { AccountPair } from "./components/CreateAccountForm";
import { fetchAccountsByKey } from "./helpers";

export const createAccount = async (account: AccountPair) => {
    const thisApplet = await getJson<string>("/common/thisservice");
    const appletId = new AppletId(thisApplet);

    const newAccount: AccountWithAuth = {
        accountNum: account.account,
        authService: account.publicKey ? "auth-ec-sys" : "auth-any-sys",
        publicKey: account.publicKey,
    };

    await operationWithTrxReceipt(appletId, "newAcc", {
        name: newAccount.accountNum,
        ...(account.publicKey && { pubKey: account.publicKey }),
    });

    return newAccount;
};

export const importAccount = async (keyPair: {
    privateKey: string;
    publicKey: string;
}) => {
    const res = await fetchAccountsByKey(keyPair.publicKey);

    if (res.length == 0) {
        throw new Error("No accounts found");
    } else {
        const accounts = res.map(
            (res): AccountWithKey => ({
                accountNum: res.account,
                authService: "auth-ec-sys",
                publicKey: res.pubkey,
                privateKey: keyPair.privateKey,
            })
        );
        return accounts;
    }
};
