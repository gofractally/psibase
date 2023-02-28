import { actions, useGlobalStore } from "store";

export const useAccountMenu = () => {
    const { state, dispatch } = useGlobalStore();
    const { accountMenu } = state;
    const { isOpen, resolver } = accountMenu;

    const show = () =>
        new Promise((resolve) => {
            dispatch(
                actions.toggleAccountMenu({
                    display: true,
                    resolver: resolve,
                })
            );
        });

    const dismiss = (withSuccess: boolean = false) => {
        dispatch(actions.toggleAccountMenu({ display: false, resolver: null }));
        resolver?.(withSuccess);
    };

    return {
        isOpen,
        show,
        dismiss,
    };
};

export default useAccountMenu;
