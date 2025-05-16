import { humanize } from "@/lib/humanize";

import { useNowUnix } from "./useNowUnix";

export const useFormatRelative = (date: Date | number | undefined | null) => {
    if (!date)
        return {
            label: "",
            hasPassed: false,
        };
    const then =
        typeof date === "number" ? date : Math.floor(date.getTime() / 1000);
    const now = useNowUnix();

    return {
        label: humanize(now - then),
        hasPassed: now > then,
    };
};
