import { actions, useGlobalStore } from "store";

export const useNavDrawer = () => {
    const { state, dispatch } = useGlobalStore();
    const { isNavDrawerOpen } = state;

    const toggle = () => dispatch(actions.toggleNavDrawer());
    const dismiss = () => {
        if (isNavDrawerOpen) toggle()
    }

    return {
        isOpen: isNavDrawerOpen,
        toggle,
        dismiss
    };
};

export default useNavDrawer;
