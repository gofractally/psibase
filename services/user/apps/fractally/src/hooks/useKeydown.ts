import { useEffect } from "react";

export const useKeydown = (key: string, callback: () => void) => {
    const processKeydown = (e: KeyboardEvent) => {
        if (e.key !== key) return;
        callback();
    };

    useEffect(() => {
        document.addEventListener("keydown", processKeydown);
        return () => {
            document.removeEventListener("keydown", processKeydown);
        };
    }, [callback, processKeydown]);
};

export default useKeydown;
