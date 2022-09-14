import React, { useRef } from "react";

import appAccountIcon from "./components/assets/icons/app-account.svg";
import { AccountsList, AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { getLoggedInUser } from "./helpers";
import { ImportAccountForm } from "./components/ImportAccountForm";

import { useAccountsWithKeys } from "./hooks/useAccountsWithKeys";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useImportAccount } from "./hooks/useImportAccount";
import { useCreateAccount } from "./hooks/useCreateAccount";
import { useAccounts } from "./hooks/useAccounts";
import { useInitialized } from "./hooks/useInitialized";

// needed for common files that won't necessarily use bundles
window.React = React;

interface KeyPair {
    privateKey: string;
    publicKey: string;
}
export interface KeyPairWithAccounts extends KeyPair {
    knownAccounts?: string[];
}

interface Account {
    accountNum: string;
    publicKey: KeyPairWithAccounts['publicKey']
}
export interface AccountWithAuth extends Account {
    authService: string;
}
export interface AccountWithKey extends AccountWithAuth {
    privateKey: KeyPairWithAccounts['privateKey']
}


function App() {
    const [accountsWithKeys, dropAccount, addAccounts] = useAccountsWithKeys();
    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useCurrentUser();

    const onLogout = (account: string) => {
        const isLoggingOutOfCurrentUser = currentUser === account;
        if (isLoggingOutOfCurrentUser) {
            setCurrentUser(accountsWithKeys[0].accountNum);
        }
        dropAccount(account)
    }


    useInitialized(async () => {
        try {
            setCurrentUser(await getLoggedInUser());
        } catch (e: any) {
            console.info(
                "App.appInitialized.useEffect().error:",
                e.message
            );
        }
    })

    const createAccountFormRef = useRef<{ resetForm: () => void }>(null);

    const [onCreateAccount, isAccountLoading, accountError] = useCreateAccount((newAccount, privateKey) => {
        createAccountFormRef.current!.resetForm()
        addAccounts([{ ...newAccount, privateKey }]);
        refreshAccounts();
    })
    const [searchKeyPair, isImportLoading, importError] = useImportAccount(addAccounts);


    return (
        <div className="ui container p-4">
            <div className="flex gap-2">
                <img src={appAccountIcon} />
                <Heading tag="h1" className="text-gray-600">
                    Accounts
                </Heading>
            </div>
            <div className="bg-slate-50">
                <AccountList
                    onLogout={onLogout}
                    selectedAccount={currentUser}
                    accounts={accountsWithKeys}
                    onSelectAccount={setCurrentUser}
                />
            </div>
            <div className="bg-slate-50 mt-4 flex justify-between">
                <CreateAccountForm errorMessage={accountError} isLoading={isAccountLoading} onCreateAccount={onCreateAccount} ref={createAccountFormRef} />
                <ImportAccountForm errorMessage={importError} isLoading={isImportLoading} onImport={searchKeyPair} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
