import { useLocalStorage } from "usehooks-ts";

export const useExpectCurrentUser = () => useLocalStorage("autoNav", true);
