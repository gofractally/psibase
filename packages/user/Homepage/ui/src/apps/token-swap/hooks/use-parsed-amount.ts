import { useMemo } from "react";

import { stringToNum } from "@/lib/stringToNum";

export const useParsedAmount = (rawAmount: string) =>
    useMemo(() => stringToNum(rawAmount), [rawAmount]);
