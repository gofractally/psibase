import dayjs from "dayjs";

import { OptionalNumber } from "@/lib/queryKeys";

export const useNextEvaluations = (
    interval: OptionalNumber,
    startTime: OptionalNumber,
    amount = 6,
): Date[] =>
    interval && startTime
        ? [...new Array(amount)].map((_, index) =>
              dayjs.unix(index * interval + startTime).toDate(),
          )
        : [];
