import { useLocalStorage } from "@uidotdev/usehooks";

export const useExpectCurrentUser = () => useLocalStorage("autoNav", true);
