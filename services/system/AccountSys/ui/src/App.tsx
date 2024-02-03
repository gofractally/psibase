import React, { useEffect, useRef, useState } from "react";

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

import { getTaposForHeadBlock, signAndPushTransaction } from "common/rpc.mjs";

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

const baseUrl = "https://account-sys.psibase.127.0.0.1.sslip.io:8080";

// npm run build && psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree r-account-sys / ./dist/ -S r-account-sys

const useConnect = () => {
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

function App() {
    const [accountsWithKeys, dropAccount, addAccounts] = useAccountsWithKeys();
    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useCurrentUser();
    const [label, setLabel] = useState("");
    const [status, setStatus] = useState("Ready");

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

    const supervisor = useConnect();

    const [waitTime, setWaitTime] = useState(0);
    const onClick = async () => {
        setStatus("Loading");
        setWaitTime(0);
        // @ts-ignore
        const msThen = new Date() / 1;
        console.log("clicked");
        console.log(supervisor, "xx");

        // @ts-ignore
        const loggedInUser = await supervisor!.getLoggedInUser();
        console.log("i am", loggedInUser);

        // @ts-ignore
        const res = await supervisor.functionCall({
            service: "account-sys",
            method: "numbers",
            params: [200, 14, true],
        });

        setLabel(res.res);
        setStatus("Loaded.");
        // @ts-ignore
        const msNow = new Date() / 1;
        const msDifference = Math.ceil((msNow - msThen) / 1000);
        setWaitTime(msDifference);
        console.log(res, "res");

        const transaction = {
            tapos: {
                ...(await getTaposForHeadBlock(baseUrl)),
                expiration: new Date(Date.now() + 10000),
            },
            actions: [
                {
                    sender: "alice", // account requesting action
                    service: "account-sys", // service executing action
                    method: "newAccount", // method to execute
                    data: {
                        name: "betty",
                        authService: "auth-any-sys",
                    },
                },
            ],
        };
        // const privateKeys = [
        // "PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V",
        // ];

        const trace = await signAndPushTransaction(
            baseUrl,
            transaction
            // privateKeys
        );
        console.log("trace is", trace);
    };

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
            <div>
                <h1>{status}</h1>
                <h2>Wait time: {waitTime} seconds</h2>
                <h2>Result: {label}</h2>
                <button
                    className="rounded-lg bg-blue-500 px-4 py-2 text-white"
                    onClick={() => onClick()}
                >
                    Do something
                </button>
            </div>
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
