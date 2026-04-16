import { useMemo } from "react";

import { stringToNum } from "@/lib/string-to-num";

export const useParsedAmount = (rawAmount: string) =>
    useMemo(() => stringToNum(rawAmount), [rawAmount]);
