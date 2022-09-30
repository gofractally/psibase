import { AppletId, getJson, operationWithTrxReceipt } from "common/rpc.mjs";
import { AccountWithAuth } from "./App";
import { AccountPair } from "./components/CreateAccountForm";

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
