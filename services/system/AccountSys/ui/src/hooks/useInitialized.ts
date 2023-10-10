import { useEffect, useState } from "react";
import { initAppFn } from "../appInit";

export const useInitialized = (callback: () => void) => {
    const [appInitialized, setAppInitialized] = useState(false);

    useEffect(() => {
        initAppFn(() => {
            setAppInitialized(true);
        });
    }, []);

    useEffect(() => {
        if (!appInitialized) {
            return;
        }
        callback();
    }, [appInitialized]);
};
