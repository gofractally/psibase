import { useLocalStorage } from "react-use";
import { useEffect, useState } from "react";
import {
    AccountWithAuth,
    AccountWithKey,
    KeyPair,
    KeyPairWithAccounts,
} from "../App";
import { fetchAccounts, fetchAccountsByKey } from "../helpers";

const toAccountWithAuth = ({
    accountNum,
    authService,
    publicKey,
}: AccountWithKey): AccountWithAuth => ({ accountNum, authService, publicKey });
const uniqueAccounts = (accounts: AccountWithAuth[]) =>
    accounts.filter(
        (account, index, arr) =>
            arr.findIndex((a) => a.accountNum === account.accountNum) == index,
    );

const partition = <T>(
    arr: T[],
    predicate: (item: T) => boolean,
): [T[], T[]] => {
    const good: T[] = [];
    const bad: T[] = [];
    arr.forEach((item) => {
        if (predicate(item)) {
            good.push(item);
        } else {
            bad.push(item);
        }
    });

    return [good, bad];
};

export const useAccountsWithKeys = (): [
    AccountWithAuth[],
    (key: string) => void,
    (accounts: AccountWithKey[]) => void,
] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);
    const [keyPairs, setKeyPairs] = useLocalStorage<KeyPairWithAccounts[]>(
        "keyPairs",
        [],
    );

    const sortedAccounts = accounts
        .slice()
        .sort((a, b) => (a.accountNum < b.accountNum ? -1 : 1));

    useEffect(() => {
        fetchAccounts().then((accounts) => {
            setAccounts((currentAccounts) => {
                const userAccounts = accounts
                    .filter((account) => !account.accountNum.includes("-sys"))
                    .filter(
                        (account) => account.authService === "auth-any-sys",
                    );
                return uniqueAccounts([...currentAccounts, ...userAccounts]);
            });
        });

        Promise.all(
            keyPairs!
                .filter((keyPair) => keyPair.publicKey)
                .map((keyPair) => fetchAccountsByKey(keyPair.publicKey)),
        ).then((responses) => {
            const flatAccounts = responses.flat(1);
            setAccounts(currentAccounts => uniqueAccounts([...flatAccounts.map((account): AccountWithAuth => ({ accountNum: account.account, authService: 'auth-sys', publicKey: account.pubkey })), ...currentAccounts]))
            const currentKeyPairs = keyPairs;
            const newKeyPairs = currentKeyPairs!.map(
                (keyPair): KeyPairWithAccounts => {
                    const relevantAccounts = flatAccounts
                        .filter(
                            (account) => account.pubkey === keyPair.publicKey,
                        )
                        .map((account) => account.account);
                    return relevantAccounts.length > 0
                        ? { ...keyPair, knownAccounts: relevantAccounts }
                        : keyPair;
                },
            );
            setKeyPairs(newKeyPairs);
        });
    }, []);

    const dropAccount = (accountNum: string) => {
        const foundAccount = accounts.find((a) => accountNum == a.accountNum);
        if (foundAccount) {
            const key = foundAccount.publicKey;
            setAccounts((accounts) =>
                accounts.filter((account) => account.publicKey !== key),
            );
            setKeyPairs(
                keyPairs!.filter((keyPair) => {
                    if (
                        "knownAccounts" in keyPair &&
                        keyPair.knownAccounts!.includes(accountNum)
                    )
                        return false;
                    return keyPair.publicKey !== key;
                }),
            );
        } else {
            console.warn(`Failed to find account ${accountNum} to drop`);
        }
    };

    const addAccount = (newAccounts: AccountWithKey[]) => {
        const plainAccounts = newAccounts.map(toAccountWithAuth);
        setAccounts((existingAccounts) => {
            const withoutExisting = existingAccounts.filter(
                (account) =>
                    !plainAccounts.some(
                        (a) => account.accountNum === a.accountNum,
                    ),
            );
            return [...withoutExisting, ...plainAccounts];
        });

        const newAccountsWithPrivateKeys = newAccounts.filter(
            (account) => "privateKey" in account,
        );
        if (newAccountsWithPrivateKeys.length > 0) {
            const incomingAccounts: KeyPairWithAccounts[] = newAccounts.map(
                (account): KeyPairWithAccounts => ({
                    privateKey: account.privateKey,
                    knownAccounts: [account.accountNum],
                    publicKey: account.publicKey,
                }),
            );
            const accountNumsCovered = incomingAccounts.flatMap(
                (account) => account.knownAccounts || [],
            );

            const easier = keyPairs!.map((keyPair) => ({
                ...keyPair,
                knownAccounts: keyPair.knownAccounts || [],
            }));
            const keypairsWithoutStaleAccounts = easier.map((keyPair) => ({
                ...keyPair,
                knownAccounts: keyPair.knownAccounts.filter(
                    (account) => !accountNumsCovered.some((a) => a === account),
                ),
            }));
            const [existingAccountsToRemain, accountsToDrop] = partition(
                keypairsWithoutStaleAccounts,
                (keyPair) => keyPair.knownAccounts.length > 0,
            );

            const combined = [...existingAccountsToRemain, ...incomingAccounts];
            const pureUniqueKeyPairs = combined
                .map(
                    ({ privateKey, publicKey }): KeyPair => ({
                        privateKey,
                        publicKey,
                    }),
                )
                .filter(
                    (keyPair, index, arr) =>
                        arr.findIndex(
                            (kp) => kp.publicKey === keyPair.publicKey,
                        ) === index,
                );

            const fresh = pureUniqueKeyPairs.map(
                (keyPair): KeyPairWithAccounts => {
                    return {
                        ...keyPair,
                        knownAccounts: combined.flatMap((kp) =>
                            kp.publicKey === keyPair.publicKey
                                ? kp.knownAccounts || []
                                : [],
                        ),
                    };
                },
            );

            console.log({ fresh }, "is to be set");

            setKeyPairs(fresh);
        }
    };
    return [sortedAccounts, dropAccount, addAccount];
};
