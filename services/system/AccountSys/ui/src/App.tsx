import React from "react";

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
import { getLoggedInUser, updateLoggedInAccount } from "./helpers";
import { ImportAccountForm } from "./components/ImportAccountForm";

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

    useInitialized(async () => {
        try {
            setCurrentUser(await getLoggedInUser());
        } catch (e: any) {
            console.info("App.appInitialized.useEffect().error:", e.message);
        }
    });

    const onSelectAccount = (account: string) => {
        setCurrentUser(account);
        updateLoggedInAccount(account);
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
