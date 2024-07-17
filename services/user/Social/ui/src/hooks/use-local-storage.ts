/* `useLocalStorage`
 *
 * Features:
 *  - JSON Serializing
 *  - Also value will be updated everywhere, when value updated (via `storage` event)
 */

import { useEffect, useState } from "react";

export function useLocalStorage<T>(
    key: string,
    defaultValue: T,
): [T | undefined, (value: T) => void, () => T | null] {
    const [value, setValue] = useState<T>();

    useEffect(() => {
        const item = localStorage.getItem(key);
        // console.log("item", item);

        if (item === undefined || item === null) {
            console.log("setting");
            localStorage.setItem(key, JSON.stringify(defaultValue));
        }

        // console.log("setValue:", JSON.parse(item!));
        setValue(item ? JSON.parse(item) : defaultValue);

        function handler(e: StorageEvent) {
            if (e.key !== key) return;

            const lsi = localStorage.getItem(key);
            setValue(JSON.parse(lsi ?? ""));
        }

        window.addEventListener("storage", handler);

        return () => {
            window.removeEventListener("storage", handler);
        };
    }, []);

    const getValue = () => {
        const stored = localStorage.getItem(key);
        return JSON.parse(stored ?? "") as T;
    };

    const setValueWrap = (value: T) => {
        // console.log("setValueWrap:", value);
        try {
            setValue(value);

            localStorage.setItem(key, JSON.stringify(value));
            if (typeof window !== "undefined") {
                window.dispatchEvent(new StorageEvent("storage", { key }));
            }
        } catch (e) {
            console.error(e);
        }
    };

    return [value, setValueWrap, getValue];
}
