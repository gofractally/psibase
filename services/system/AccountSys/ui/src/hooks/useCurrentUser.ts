import { useLocalStorage } from "common/useLocalStorage.mjs";

export const useCurrentUser = (): [string, (newUser: string) => void] => {
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    return [currentUser, setCurrentUser]
}