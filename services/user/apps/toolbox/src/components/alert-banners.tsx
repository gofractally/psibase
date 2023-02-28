import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "@toolbox/components/ui";

import { useGlobalStore } from "store";
import { actionDismissAlertBanner } from "store/actions";

export type AlertBannerType = "set-up-profile" | null;

interface BannerProps {
    onDismiss?: () => void;
}

const SetUpProfile = ({ onDismiss }: BannerProps) => {
    const navigate = useNavigate();
    const { dispatch } = useGlobalStore();

    const goToProfile = (e: React.MouseEvent) => {
        e.preventDefault();
        dispatch(actionDismissAlertBanner());
        navigate("/account");
    };

    return (
        <AlertBanner hasCloseButton iconType="user-hex" onDismiss={onDismiss}>
            You don't just get an address: you can have a profile as well!{" "}
            <a href="#" onClick={goToProfile}>
                Fill out your profile now
            </a>
            !
        </AlertBanner>
    );
};

const AlertBanners = () => {
    const { state, dispatch } = useGlobalStore();

    const dismiss = () => {
        dispatch(actionDismissAlertBanner());
    };

    switch (state.alertBanner) {
        case "set-up-profile":
            return <SetUpProfile onDismiss={dismiss} />;
        default:
            return null;
    }
};

export default AlertBanners;
