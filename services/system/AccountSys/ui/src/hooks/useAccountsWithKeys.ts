import { useLocalStorage } from "common/useLocalStorage.mjs";
import { useEffect, useState } from "react";
import { AccountWithAuth, AccountWithKey, KeyPairWithAccounts } from "../App";
import { fetchAccounts, fetchAccountsByKey } from "../helpers";



const toAccountWithAuth = ({ accountNum, authService, publicKey }: AccountWithKey): AccountWithAuth => ({ accountNum, authService, publicKey });
const uniqueAccounts = (accounts: AccountWithAuth[]) => accounts.filter((account, index, arr) => arr.findIndex(a => a.accountNum === account.accountNum) == index);



export const useAccountsWithKeys = (): [AccountWithAuth[], (key: string) => void, (accounts: AccountWithKey[]) => void] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);
    const [keyPairs, setKeyPairs] = useLocalStorage<KeyPairWithAccounts[]>('keyPairs', [])

    const sortedAccounts = accounts.slice().sort((a, b) => a.accountNum < b.accountNum ? -1 : 1);

    useEffect(() => {

        fetchAccounts().then(accounts => setAccounts(currentAccounts => {
            const userAccounts = accounts.filter(account => !account.accountNum.includes('-sys')).filter(account => account.authService === 'auth-any-sys');
            return uniqueAccounts([...currentAccounts, ...userAccounts])
        }));

        Promise.all(keyPairs.map(keyPair => fetchAccountsByKey(keyPair.publicKey))).then(responses => {
            const flatAccounts = responses.flat(1);
            setAccounts(currentAccounts => uniqueAccounts([...flatAccounts.map((account): AccountWithAuth => ({ accountNum: account.account, authService: 'auth-ec-sys', publicKey: account.pubkey })), ...currentAccounts]))
            const currentKeyPairs = keyPairs;
            const newKeyPairs = currentKeyPairs.map((keyPair): KeyPairWithAccounts => {
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
            const newKeyPairs: KeyPairWithAccounts[] = newAccounts.map((account): KeyPairWithAccounts => ({ privateKey: account.privateKey, knownAccounts: [account.accountNum], publicKey: account.publicKey }));
            setKeyPairs([...keyPairs.filter(pair => !newKeyPairs.some(p => p.publicKey === pair.publicKey)), ...newKeyPairs])
        }
    };
    return [sortedAccounts, dropAccount, addAccount];
};
