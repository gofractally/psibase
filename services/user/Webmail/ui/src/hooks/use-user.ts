import { useEffect, useState } from "react";
import { atom, useAtom, useAtomValue } from "jotai";

import { type PluginId, Supervisor } from "@psibase/common-lib";

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

const supervisor = new Supervisor();
const getSupervisor = async () => {
    if (supervisor.isSupervisorInitialized) return supervisor;
    await supervisor.onLoaded();
    // TODO: preloadPlugins appears to not work at all via vite proxy; investigate
    // supervisor.preLoadPlugins([
    //     { service: "accounts" },
    //     { service: "webmail" },
    // ]);
    return supervisor;
};

// TODO: Get rid of pretty names for now
const userAtom = atom<Account>(accounts[0]);
export function useUser() {
    const [user, setUser] = useAtom<Account>(userAtom);

    const getLoggedInUser = async () => {
        const supervisor = await getSupervisor();
        try {
            return supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "getLoggedInUser",
                params: [window.origin],
            });
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`);
        }
    };

    const logInAs = async (accountName: string) => {
        const supervisor = await getSupervisor();
        const res = await supervisor.functionCall({
            service: "accounts",
            intf: "accounts",
            method: "loginTemp",
            params: [accountName],
        });
        console.log(res);
        await getLoggedInAccount();
    };

    const getLoggedInAccount = async () => {
        const account = await getLoggedInUser();
        console.log("USER:", account);
        const user = accounts.find((a) => a.account === account) ?? accounts[0];
        setUser(user);
    };

    useEffect(() => {
        console.log("useEffect");
        getLoggedInAccount();
    }, []);

    return {
        user,
        setUser: logInAs,
    };
}
