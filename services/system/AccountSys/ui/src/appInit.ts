import {
    initializeApplet,
    action,
    operation,
    query,
    setOperations,
    setQueries,
    signTransaction,
    getJson,
    AppletId,
} from "common/rpc.mjs";

import { useLocalStorage } from "common/useLocalStorage.mjs";
import { KeyPair } from "./App";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chill = async (ms: number = 3000) => {
    console.log(`just chilling for ${ms} ms first...`)
    await wait(ms);
    console.log('chilled');
}

export const initAppFn = (setAppInitialized: () => void) =>
    initializeApplet(async () => {
        interface execArgs {
            name?: any;
            pubKey?: any;
            transaction?: any;
        }

        const thisApplet = await getJson<string>("/common/thiscontract");
        const accountSysApplet = new AppletId(thisApplet, "");

        setOperations([
            {
                id: "newAcc",
                exec: async ({ name, pubKey }: execArgs) => {
                    action(thisApplet, "newAccount", {
                        name,
                        authContract: "auth-any-sys",
                        requireNew: true,
                    });

                    if (pubKey && pubKey !== "") {
                        operation(accountSysApplet, "setKey", { name, pubKey });
                    }
                },
            },
            {
                id: "setKey",
                exec: async ({ name, pubKey }: execArgs) => {
                    if (pubKey !== "") {
                        action("auth-ec-sys", "setKey", { key: pubKey }, name);
                        action(
                            thisApplet,
                            "setAuthCntr",
                            { authContract: "auth-ec-sys" },
                            name
                        );
                    }
                },
            },
        ]);
        setQueries([
            {
                id: "getLoggedInUser",
                exec: (params: any) => {
                    // TODO - Get the actual logged in user
                    return JSON.parse(
                        window.localStorage.getItem("currentUser") || ""
                    );
                },
            },
            {
                id: "getAuthedTransaction",
                exec: async ({ transaction }: execArgs) => {
                    const [user, accounts] = await Promise.all([query(accountSysApplet, "getLoggedInUser"), getJson("/accounts")]);

                    const sendingAccount = accounts.find((a: any) => a.accountNum === user);
                    const isSecureAccount = sendingAccount.authContract === "auth-ec-sys"
                    if (isSecureAccount) {
                        const keys = JSON.parse(localStorage.getItem('keyPairs') || '[]') as KeyPair[]

                        const privateKeyToFind = 'PUB_K1_5BFmf4uRdpb4uSg1yE5AwJ5Mh7gq6oJnf4YKqXoKtGoZJ49UVc';
                        const foundKey = keys.find(key => key.publicKey === privateKeyToFind);

                        if (foundKey) {
                            const signingPrivateKey = foundKey.privateKey;
                            return signTransaction("", transaction, [signingPrivateKey]);
                        } else {
                            throw new Error(`Failed to find the private key for public key ${privateKeyToFind}`);
                        }

                    } else {
                        return signTransaction("", transaction);
                    }
                },
            },
        ]);
        setAppInitialized();
    });
