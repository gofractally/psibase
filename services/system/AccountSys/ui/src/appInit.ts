import {
    initializeApplet,
    action,
    operation,
    query,
    setOperations,
    setQueries,
    signTransaction,
    getJson,
} from "common/rpc.mjs";

export const initAppFn = (setAppInitialized: () => void) =>
    initializeApplet(async () => {
        interface execArgs {
            name?: any;
            pubKey?: any;
            transaction?: any;
        }
        const thisApplet = await getJson("/common/thiscontract");
        setOperations([
            {
                id: "newAcc",
                exec: async ({ name, pubKey }: execArgs) => {
                    action(thisApplet, "newAccount", {
                        name,
                        authContract: "auth-any-sys",
                        requireNew: true,
                    });

                    if (pubKey !== "") {
                        operation(thisApplet, "setKey", { name, pubKey });
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
                    let user = await query(thisApplet, "", "getLoggedInUser");
                    let accounts = await getJson("/accounts");
                    let u = accounts.find((a: any) => a.accountNum === user);
                    if (u.authContract === "auth-ec-sys") {
                        // Todo: Should sign with the private key mapped to the logged-in
                        //        user stored in localstorage
                        return await signTransaction("", transaction, [
                            "PVT_K1_22vrGgActn3X4H1wwvy2KH4hxGke7cGy6ypy2njMjnyZBZyU7h",
                        ]);
                    } else return await signTransaction("", transaction);
                },
            },
        ]);
        setAppInitialized();
    });
