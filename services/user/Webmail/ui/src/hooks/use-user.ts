import { useEffect } from "react";
import { atom, useAtom } from "jotai";

import { type PluginId } from "@psibase/common-lib";

import { getSupervisor } from "@lib/supervisor";

import { accounts } from "src/fixtures/data";

interface Account {
    name: string;
    account: string;
}
interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

// TODO: Get rid of pretty names for now
const accountsAtom = atom<Account[]>([]);
const userAtom = atom<Account>(accounts[0]);
export function useUser() {
    const [availableAccounts, setAvailableAccounts] = useAtom(accountsAtom);
    const [user, setUser] = useAtom<Account>(userAtom);

    const getAvailableAccounts = async () => {
        const supervisor = await getSupervisor();
        try {
            const res = (await supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "getAvailableAccounts",
                params: [],
            })) as string[];
            const accountsAsUsers = res
                .map((a) => {
                    return accounts.find((one) => one.account === a);
                })
                .filter(Boolean) as Account[];
            setAvailableAccounts(accountsAsUsers);
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`);
        }
    };

    const logInAs = async (accountName: string) => {
        const supervisor = await getSupervisor();
        try {
            await supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "loginTemp",
                params: [accountName],
            });
            const user = accounts.find((a) => a.account === accountName);
            if (!user) return;
            setUser(user);
        } catch (e: unknown) {
            console.error("ERROR setting user:");
            console.log(e);
        }
    };

    useEffect(() => {
        getAvailableAccounts();
    }, []);

    return {
        availableAccounts,
        user,
        setUser: logInAs,
    };
}
