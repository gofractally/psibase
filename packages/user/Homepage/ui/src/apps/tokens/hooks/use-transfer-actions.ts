import { atom, useAtom } from "jotai";

type HandleSetMaxAmountFn =
    | ((e: React.MouseEvent<HTMLButtonElement>) => void)
    | null;
type ClearAmountErrorsFn = (() => void) | null;

const handleSetMaxAmountAtom = atom<HandleSetMaxAmountFn>(null);
const clearAmountErrorsAtom = atom<ClearAmountErrorsFn>(null);

export function useTransferActions() {
    const [handleSetMaxAmount, setHandleSetMaxAmount] = useAtom(
        handleSetMaxAmountAtom,
    );
    const [clearAmountErrors, setClearAmountErrors] = useAtom(
        clearAmountErrorsAtom,
    );

    return {
        handleSetMaxAmount,
        setHandleSetMaxAmount,
        clearAmountErrors,
        setClearAmountErrors,
    };
}
