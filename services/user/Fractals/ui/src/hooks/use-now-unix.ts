import dayjs from "dayjs";
import { useState } from "react";
import { useInterval } from "usehooks-ts";

export const useNowUnix = (interval = 1000) => {
    const [now, setNow] = useState<number>(dayjs().unix());

    useInterval(() => {
        setNow(() => dayjs().unix());
    }, interval);

    return now;
};
