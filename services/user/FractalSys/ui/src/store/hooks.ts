import { createContext, useContext } from "react";

import { ContextType } from "./types";

export const store = createContext<ContextType | null>(null);

export const useGlobalStore = () => {
    const globalStore = useContext(store);
    if (!globalStore) throw new Error("hook should be within store provider");
    return globalStore;
};
