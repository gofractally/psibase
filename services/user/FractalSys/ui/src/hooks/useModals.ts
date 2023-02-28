import { actions, useGlobalStore } from "store";
import { useModalScenes } from "components/modals";

export const useModalExample = () => {
    const { state, dispatch } = useGlobalStore();
    const { modalExample } = state;
    const { isOpen, resolver } = modalExample;

    const show = () =>
        new Promise<boolean>((resolve) => {
            dispatch(
                actions.toggleModalExample({
                    display: true,
                    resolver: resolve,
                })
            );
        });

    const dismiss = (withSuccess = false) => {
        dispatch(
            actions.toggleModalExample({ display: false, resolver: null })
        );
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

    const sceneActions = useModalScenes();

    const show = () =>
        dispatch(
            actions.toggleModalCreateAddress({
                display: true,
                resolver: null,
            })
        );

    const dismiss = () =>
        dispatch(
            actions.toggleModalCreateAddress({
                display: false,
                resolver: null,
            })
        );

    return {
        isOpen,
        show,
        dismiss,
        ...sceneActions,
    };
};

export const useModalSignup = () => {
    const { state, dispatch } = useGlobalStore();
    const { modalSignup } = state;
    const { isOpen, resolver } = modalSignup;

    const sceneActions = useModalScenes();

    const show = () =>
        new Promise<boolean>((resolve) => {
            dispatch(
                actions.toggleModalSignup({
                    display: true,
                    resolver: resolve,
                })
            );
        });

    const dismiss = (withSuccess = false) => {
        dispatch(actions.toggleModalSignup({ display: false, resolver: null }));
        resolver?.(withSuccess);
        sceneActions.resetScene();
    };

    return {
        isOpen,
        show,
        dismiss,
        ...sceneActions,
    };
};

export const useModalLogin = () => {
    const { state, dispatch } = useGlobalStore();
    const { modalLogin } = state;
    const { isOpen } = modalLogin;

    const show = () => {
        dispatch(actions.toggleModalLogin({ display: true, resolver: null }));
    };

    const dismiss = () => {
        dispatch(actions.toggleModalLogin({ display: false, resolver: null }));
    };

    return {
        isOpen,
        show,
        dismiss,
    };
};
