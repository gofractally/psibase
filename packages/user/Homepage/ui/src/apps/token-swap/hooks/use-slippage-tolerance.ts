import { useLocalStorage } from "usehooks-ts";

export const useSlippageTolerance = () => {
    return useLocalStorage<number>("slippageTolerance", 0.005);
};
