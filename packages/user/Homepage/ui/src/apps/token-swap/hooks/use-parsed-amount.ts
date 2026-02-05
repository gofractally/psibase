import { stringToNum } from "@/lib/stringToNum";
import { useMemo } from "react";


export const useParsedAmount = (rawAmount: string) =>
  useMemo(() => stringToNum(rawAmount), [rawAmount]);
