import { useLocalStorage } from "react-use";

export const useCurrentUser = (): [string, (newUser: string) => void] => {
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    return [currentUser!, setCurrentUser];
};
