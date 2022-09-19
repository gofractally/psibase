import { useRef, EffectCallback, DependencyList, useEffect } from "react";

/**
 *
 * @param effect
 * @param dependencies
 * @description Hook to prevent running the useEffect beyond the first render
 *
 */
export default function useEffectOnce(
    effect: EffectCallback,
    dependencies?: DependencyList
) {
    // Preserving the true by default as initial render cycle
    const initialRender = useRef(true);

    useEffect(() => {
        let effectReturns: void | (() => void) = () => {};

        /**
         * Updating the ref to false on the first render, causing
         * subsequent render to no longer execute the effect
         *
         */
        if (initialRender.current) {
            effectReturns = effect();
            initialRender.current = false;
        }

        /**
         * Preserving and allowing the Destructor returned by the effect
         * to execute on component unmount and perform cleanup if
         * required.
         *
         */
        if (effectReturns && typeof effectReturns === "function") {
            return effectReturns;
        } else {
            return undefined;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, dependencies);
}
