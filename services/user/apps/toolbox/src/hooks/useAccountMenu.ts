import { useGlobalStore } from "store";
import { actionToggleAccountMenu } from "store/actions";

export const useAccountMenu = () => {
    const { state, dispatch } = useGlobalStore();
    const { accountMenu } = state;
    const { isOpen, resolver } = accountMenu;

    const show = () =>
        new Promise((resolve) => {
            dispatch(
                actionToggleAccountMenu({ display: true, resolver: resolve })
            );
        });

    const dismiss = (withSuccess: boolean = false) => {
        dispatch(actionToggleAccountMenu({ display: false, resolver: null }));
        resolver?.(withSuccess);
    };

    return {
        isOpen,
        show,
        dismiss,
    };
};

export default useAccountMenu;
