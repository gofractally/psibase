import { useGlobalStore } from "store";
import { actionDismissAlertBanner, actionSetAlertBanner } from "store/actions";
import { AlertBannerType } from "components";

export const useAlertBanner = ({ name }: { name: AlertBannerType }) => {
    const { state, dispatch } = useGlobalStore();
    const { alertBanner } = state;

    const show = () => {
        dispatch(actionSetAlertBanner("set-up-profile"));
    };

    const dismiss = () => {
        dispatch(actionDismissAlertBanner());
    };

    return {
        isOpen: alertBanner === name,
        show,
        dismiss,
    };
};

export default useAlertBanner;
