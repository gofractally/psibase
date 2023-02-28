import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "@toolbox/components/ui";

import { actions, useGlobalStore } from "store";

export type AlertBannerType = "set-up-profile" | null;

interface BannerProps {
    onDismiss?: () => void;
}

const SetUpProfile = ({ onDismiss }: BannerProps) => {
    const navigate = useNavigate();
    const { dispatch } = useGlobalStore();

    const goToProfile = (e: React.MouseEvent) => {
        e.preventDefault();
        dispatch(actions.dismissAlertBanner());
        navigate("/meeting");
    };

    return (
        <AlertBanner hasCloseButton iconType="user-hex" onDismiss={onDismiss}>
            <span className="font-normal">
                You don&apos;t just get an address: you can have a profile as
                well!
            </span>{" "}
            <a
                href="#"
                onClick={goToProfile}
                className="font-medium hover:text-gray-400"
            >
                Fill out your profile now
            </a>
            !
        </AlertBanner>
    );
};

export const AlertBanners = ({ className = "" }: { className?: string }) => {
    const { state, dispatch } = useGlobalStore();

    const dismiss = () => {
        dispatch(actions.dismissAlertBanner());
    };

    const renderBanner = () => {
        switch (state.alertBanner) {
            case "set-up-profile":
                return <SetUpProfile onDismiss={dismiss} />;
            default:
                return null;
        }
    };

    return <div className={className}>{renderBanner()}</div>;
};

export default AlertBanners;
