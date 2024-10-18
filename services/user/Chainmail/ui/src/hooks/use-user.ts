import { useEffect } from "react";
import { atom, useAtom } from "jotai";

import { type PluginId } from "@psibase/common-lib";

import { getSupervisor } from "@lib/supervisor";
interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

const accountsAtom = atom<string[]>([]);
const userAtom = atom<string | undefined>(undefined);
export function useUser() {
    const [availableAccounts, setAvailableAccounts] = useAtom(accountsAtom);
    const [user, setUser] = useAtom(userAtom);

    const getAvailableAccounts = async () => {
        const supervisor = await getSupervisor();
        try {
            const res = (await supervisor.functionCall({
                service: "accounts",
                intf: "accounts",
                method: "getAvailableAccounts",
                params: [],
            })) as string[];
            setAvailableAccounts(res);
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
            setUser(accountName);
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
