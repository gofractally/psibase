import { useLocalStorage } from "usehooks-ts";

export const useSlippageTolerance = () =>
    useLocalStorage<number>("slippageTolerance", 0.005);
