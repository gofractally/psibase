import React, { useEffect, useState } from "react";

import { AppletId, getJson, operation, siblingUrl } from "common/rpc.mjs";
import { useLocalStorage } from "common/useLocalStorage.mjs";

import appAccountIcon from "./components/assets/icons/app-account.svg";

import { AccountsList, AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { getLoggedInUser } from "./helpers";
import { initAppFn } from "./appInit";
import { AccountPair } from "./components/CreateAccountForm";
import { ImportAccountForm } from "./components/ImportAccountForm";



// needed for common files that won't necessarily use bundles
window.React = React;

export interface KeyPair {
    privateKey: string;
    publicKey: string;
    knownAccounts?: string[];
}

interface Account {
    accountNum: string;
    publicKey: KeyPair['publicKey']
}
export interface AccountWithAuth extends Account {
    authService: string;
}
interface AccountWithKey extends AccountWithAuth {
    privateKey: KeyPair['privateKey']
}

const toAccountWithAuth = ({ accountNum, authService, publicKey }: AccountWithKey): AccountWithAuth => ({ accountNum, authService, publicKey });

const fetchAccountsByKey = async (publicKey: string) => {
    if (!publicKey) throw new Error(`No public key found ${publicKey}`)
    return getJson<{ account: string; pubkey: string }[]>(await siblingUrl(null, 'auth-ec-sys', "accwithkey/" + publicKey))

}


const uniqueAccounts = (accounts: AccountWithAuth[]) => accounts.filter((account, index, arr) => arr.findIndex(a => a.accountNum === account.accountNum) == index);

const useAccountsWithKeys = (): [AccountWithAuth[], (key: string) => void, (accounts: AccountWithKey[]) => void] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);
    const [keyPairs, setKeyPairs] = useLocalStorage<KeyPair[]>('keyPairs', [])

    const sortedAccounts = accounts.slice().sort((a, b) => a.accountNum < b.accountNum ? -1 : 1);

    useEffect(() => {

        fetchAccounts().then(accounts => setAccounts(currentAccounts => {
            const userAccounts = accounts.filter(account => !account.accountNum.includes('-sys')).filter(account => account.authService === 'auth-any-sys');
            console.log({ currentAccounts, userAccounts, accounts })

            return uniqueAccounts([...currentAccounts, ...userAccounts])
        }));

        Promise.all(keyPairs.map(keyPair => fetchAccountsByKey(keyPair.publicKey))).then(responses => {
            const flatAccounts = responses.flat(1);
            setAccounts(currentAccounts => uniqueAccounts([...flatAccounts.map((account): AccountWithAuth => ({ accountNum: account.account, authService: 'auth-ec-sys', publicKey: account.pubkey })), ...currentAccounts]))
            const currentKeyPairs = keyPairs;
            const newKeyPairs = currentKeyPairs.map((keyPair): KeyPair => {
                const relevantAccounts = flatAccounts.filter(account => account.pubkey === keyPair.publicKey).map(account => account.account)
                return relevantAccounts.length > 0 ? { ...keyPair, knownAccounts: relevantAccounts } : keyPair
            })
            setKeyPairs(newKeyPairs)
        })

    }, [])

    const dropAccount = (accountNum: string) => {
        const foundAccount = accounts.find(a => accountNum == a.accountNum);
        if (foundAccount) {
            const key = foundAccount.publicKey;
            setAccounts(accounts => accounts.filter(account => account.publicKey !== key));
            setKeyPairs(keyPairs.filter(keyPair => keyPair.publicKey !== key))
        } else {
            console.warn(`Failed to find account ${accountNum} to drop`)
        }
    };


    const addAccount = (newAccounts: AccountWithKey[]) => {
        const plainAccounts = newAccounts.map(toAccountWithAuth);
        setAccounts(existingAccounts => {
            const withoutExisting = existingAccounts.filter(account => !plainAccounts.some(a => account.accountNum === a.accountNum))
            return [...withoutExisting, ...plainAccounts]
        });

        const newAccountsWithPrivateKeys = newAccounts.filter(account => 'privateKey' in account);
        if (newAccountsWithPrivateKeys.length > 0) {
            const newKeyPairs: KeyPair[] = newAccounts.map((account): KeyPair => ({ privateKey: account.privateKey, knownAccounts: [account.accountNum], publicKey: account.publicKey }));
            setKeyPairs([...keyPairs.filter(pair => !newKeyPairs.some(p => p.publicKey === pair.publicKey)), ...newKeyPairs])
        }
    };
    return [sortedAccounts, dropAccount, addAccount];
};


const fetchAccounts = async () => {
    try {
        const accounts = await getJson<AccountWithAuth[]>("/accounts");
        console.log('fetched:', accounts)
        return accounts;
    } catch (e) {
        console.info("refreshAccounts().catch().e:");
        console.info(e);
        return []
    }
}

const useAccounts = (): [AccountWithAuth[], () => void] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);

    const refreshAccounts = async () => {
        const res = await fetchAccounts()
        setAccounts(res);
    }

    useEffect(() => { refreshAccounts() }, []);

    return [accounts, refreshAccounts];
};


const useData = (loadingState: boolean = false) => {
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(loadingState);
    return { isLoading, error, setError, setIsLoading }
}

const useCurrentUser = (): [string, (newUser: string) => void] => {
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    return [currentUser, setCurrentUser]
}

function App() {
    const [appInitialized, setAppInitialized] = useState(false);
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

    const [name, setName] = useState("");
    const [pubKey, setPubKey] = useState("");
    const [privKey, setPrivKey] = useState("");

    const { error: accountError, setError: setAccountError, isLoading: isAccountLoading, setIsLoading: setIsAccountLoading } = useData()


    useEffect(() => {
        initAppFn(() => {
            setAppInitialized(true);
        });
    }, []);
    useEffect(() => {
        if (!appInitialized) {
            return;
        }
        (async () => {
            // initializeApplet();
            try {
                setCurrentUser(await getLoggedInUser());
            } catch (e: any) {
                console.info(
                    "App.appInitialized.useEffect().error:",
                    e.message
                );
            }
        })();
    }, [appInitialized]);


    const onCreateAccount = async (account: AccountPair) => {

        try {
            setIsAccountLoading(true)
            setAccountError('')
            const thisApplet = await getJson<string>("/common/thisservice");
            const appletId = new AppletId(thisApplet)

            const newAccount: AccountWithAuth = {
                accountNum: account.account,
                authService: account.publicKey ? 'auth-ec-sys' : 'auth-any-sys',
                publicKey: account.publicKey
            }

            operation(appletId, 'newAcc', { name: newAccount.accountNum, ...(account.publicKey && { pubKey: account.publicKey }) });

            refreshAccounts();
            addAccounts([{ ...newAccount, privateKey: account.privateKey }]);
            setPrivKey('');
            setPubKey('')
            setName('')
        } catch (e: any) {
            setAccountError(e.message)
            console.error(e, 'q');
        } finally {
            setIsAccountLoading(false);
        }
    };


    const { isLoading: isImportLoading, setIsLoading: setImportLoading, setError: setImportError, error: importError } = useData()


    const onImport = async (acc: { privateKey: string; publicKey: string }) => {
        try {
            setImportLoading(true);
            setImportError('');

            const res = await fetchAccountsByKey(acc.publicKey);
            if (res.length == 0) throw new Error(`No accounts found with public key ${acc.publicKey}`);

            if (res.length > 0) {
                const accounts = res.map((res): AccountWithKey => ({ accountNum: res.account, authService: 'auth-ec-sys', publicKey: res.pubkey, privateKey: acc.privateKey }));
                addAccounts(accounts);
                const newAccountsFound = res.filter(account => !accountsWithKeys.some(a => a.accountNum == account.account && account.pubkey == a.publicKey));
                if (newAccountsFound.length == 0) throw new Error("No new accounts found")
            }
        } catch (e) {
            setImportError(`${e}`)
        } finally {
            setImportLoading(false)
        }
    }
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
                <CreateAccountForm name={name} privKey={privKey} pubKey={pubKey} setPrivKey={setPrivKey} setPubKey={setPubKey} setName={setName} errorMessage={accountError} isLoading={isAccountLoading} onCreateAccount={onCreateAccount} />
                <ImportAccountForm errorMessage={importError} isLoading={isImportLoading} onImport={onImport} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
