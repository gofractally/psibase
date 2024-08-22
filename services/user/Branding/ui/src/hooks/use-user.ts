import { atom, useAtom } from "jotai";
import { accounts } from "src/fixtures/data";

interface Account {
    name: string;
    account: string;
}

const userAtom = atom<Account>(accounts[0]);
export function useUser() {
    return useAtom(userAtom);
}
