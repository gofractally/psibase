import { useLocalStorage } from "common/useLocalStorage.mjs";

export const useCurrentUser = (): [string, (newUser: string) => void, boolean] => {
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    const isAuthenticated = currentUser !== '';
    return [currentUser, setCurrentUser, isAuthenticated]
}