import { useGlobalStore } from "store";
import {
    actionToggleModalCreateAddress,
    actionToggleModalExample,
} from "store/actions";

export const useModalExample = () => {
    const { state, dispatch } = useGlobalStore();
    const { modalExample } = state;
    const { isOpen, resolver } = modalExample;

    const show = () =>
        new Promise<boolean>((resolve) => {
            dispatch(
                actionToggleModalExample({ display: true, resolver: resolve })
            );
        });

    const dismiss = (withSuccess = false) => {
        dispatch(actionToggleModalExample({ display: false, resolver: null }));
        resolver?.(withSuccess);
    };

    return {
        isOpen,
        show,
        dismiss,
    };
};

export const useModalCreateAddress = () => {
    const { state, dispatch } = useGlobalStore();
    const { modalCreateAddress } = state;
    const { isOpen } = modalCreateAddress;

    const show = () =>
        dispatch(
            actionToggleModalCreateAddress({ display: true, resolver: null })
        );

    const dismiss = () =>
        dispatch(
            actionToggleModalCreateAddress({ display: false, resolver: null })
        );

    return {
        isOpen,
        show,
        dismiss,
    };
};
