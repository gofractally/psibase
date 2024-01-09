import React, { useEffect, useRef } from "react";

import {
    useAccountsWithKeys,
    useCurrentUser,
    useAccounts,
    useInitialized,
} from "./hooks";

import AccountIcon from "./components/assets/icons/app-account.svg";
import {
    AccountsList,
    AccountList,
    CreateAccountForm,
    Heading,
} from "./components";
import { getLoggedInUser, updateAccountInCommonNav } from "./helpers";
import { ImportAccountForm } from "./components/ImportAccountForm";
import { connect } from "@psibase/plugin";

// deploy the wasm
// install the plugin

// needed for common files that won't necessarily use bundles
window.React = React;

export interface KeyPair {
    privateKey: string;
    publicKey: string;
}
export interface KeyPairWithAccounts extends KeyPair {
    knownAccounts?: string[];
}

interface Account {
    accountNum: string;
    publicKey: KeyPairWithAccounts["publicKey"];
}
export interface AccountWithAuth extends Account {
    authService: string;
}
export interface AccountWithKey extends AccountWithAuth {
    privateKey: KeyPairWithAccounts["privateKey"];
}


//  psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree r-account-sys / ./dist/ -S r-account-sys

function App() {
    const [accountsWithKeys, dropAccount, addAccounts] = useAccountsWithKeys();
    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useCurrentUser();

    const onLogout = (account: string) => {
        const isLoggingOutOfCurrentUser = currentUser === account;
        if (isLoggingOutOfCurrentUser) {
            const nextAccount = accountsWithKeys.find(
                (acc) =>
                    acc.accountNum !== account &&
                    acc.authService !== "auth-any-sys"
            );
            const newUser =
                typeof nextAccount === "undefined"
                    ? ""
                    : nextAccount.accountNum;
            setCurrentUser(newUser);
        }
        dropAccount(account);
    };

    const ran = useRef(false);

    // npm run build && psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree psispace-sys / ./dist/ -S account-sys

    const init = async () => {
        if (ran.current) return;
        ran.current = true;
        console.count("init");

        const supervisor = await connect();
        console.log(supervisor, "came back casey");
        try {
            // todo
            // make it work with several params?
            const res = await supervisor.functionCall({
                service: "account-sys",
                method: "numbers",
                params: [200, 14, true],
            });
            console.log({ supervisor, res, x: 111 });
            console.log(res, "numbers *");
            const user = {
                name: "john",
                age: 29,
            };
            const strings = await supervisor.functionCall({
                service: "account-sys",
                method: "strings",
                params: ["user"],
            });
            console.log(strings, "strings *");
            const peoples = await supervisor.functionCall({
                service: "account-sys",
                method: "peoples",
                params: [[user, user]],
            });
            console.log(peoples, "peoples *");
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        init();
    }, []);

    useInitialized(async () => {
        try {
            setCurrentUser(await getLoggedInUser());
        } catch (e: any) {
            console.info("App.appInitialized.useEffect().error:", e.message);
        }
    });

    const onSelectAccount = (account: string) => {
        setCurrentUser(account);
        updateAccountInCommonNav(account);
    };

    return (
        <div className="mx-auto max-w-screen-xl space-y-4 p-2 sm:px-8">
            <div className="flex items-center gap-2">
                <AccountIcon />
                <Heading tag="h1" className="select-none text-gray-600">
                    Accounts
                </Heading>
            </div>
            <AccountList
                onLogout={onLogout}
                selectedAccount={currentUser}
                accounts={accountsWithKeys}
                onSelectAccount={onSelectAccount}
            />
            {currentUser && (
                <CreateAccountForm
                    addAccounts={addAccounts}
                    refreshAccounts={refreshAccounts}
                />
            )}
            <ImportAccountForm addAccounts={addAccounts} />
            {/* <SetAuth /> */}
            <AccountsList accounts={allAccounts} />
        </div>
    );
}

export default App;
