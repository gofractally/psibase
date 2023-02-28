import { createContext, useContext } from "react";

import { ContextType } from "./types";

export const store = createContext<ContextType | null>(null);

export const useGlobalStore = () => {
    const globalStore = useContext(store);
    if (!globalStore) throw new Error("hook should be within store provider");
    return globalStore;
};

export const useParam = (key: string) => {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
};
