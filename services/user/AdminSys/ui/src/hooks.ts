import { useEffect, useState } from "react";

import { getJson } from "@psibase/common-lib";

export const usePollJson = <R>(
    url: string
): [R | undefined, string | undefined, () => void] => {
    const [pollTimer, setPollTimer] = useState<
        ReturnType<typeof setTimeout> | null | undefined
    >();
    const [error, setError] = useState<string>();
    const [value, setValue] = useState<R>();
    useEffect(() => {
        if (pollTimer === undefined) {
            setPollTimer(null);
            (async () => {
                try {
                    let result = await getJson(url);
                    setValue(result);
                    setError(undefined);
                    setPollTimer(
                        setTimeout(() => setPollTimer(undefined), 3000)
                    );
                } catch (e) {
                    setError(`Failed to load ${url}`);
                    setPollTimer(
                        setTimeout(() => setPollTimer(undefined), 10000)
                    );
                }
            })();
        }
    }, [pollTimer]);
    return [
        value,
        error,
        () => {
            if (pollTimer !== undefined && pollTimer !== null) {
                clearTimeout(pollTimer);
                setPollTimer(undefined);
            }
        },
    ];
};
