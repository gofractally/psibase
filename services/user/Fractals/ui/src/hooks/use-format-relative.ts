import { humanize } from "@/lib/humanize";

import { useNowUnix } from "./use-now-unix";

export const useFormatRelative = (date: Date | number | undefined | null) => {
    const now = useNowUnix();
    if (!date)
        return {
            label: "",
            hasPassed: false,
        };
    const then =
        typeof date === "number" ? date : Math.floor(date.getTime() / 1000);

    return {
        label: humanize(now - then),
        hasPassed: now > then,
    };
};
