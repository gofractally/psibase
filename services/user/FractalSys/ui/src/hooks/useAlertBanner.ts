import { actions, useGlobalStore } from "store";
import { AlertBannerType } from "components";

export const useAlertBanner = ({ name }: { name: AlertBannerType }) => {
    const { state, dispatch } = useGlobalStore();
    const { alertBanner } = state;

    const show = () => {
        dispatch(actions.setAlertBanner("set-up-profile"));
    };

    const dismiss = () => {
        dispatch(actions.dismissAlertBanner());
    };

    return {
        isOpen: alertBanner === name,
        show,
        dismiss,
    };
};

export default useAlertBanner;
