import React from "react";

import Icon, { IconType, IconStyle } from "./Icon";
import Text from "./Text";

export interface DrawerNavButtonProps {
    isActive?: boolean;
    isLive?: boolean;
    iconType?: IconType;
    iconStyle?: IconStyle;
    className?: string;
    onClick?: () => void;
    children: React.ReactText;
}

export const DrawerNavButton = ({
    isActive = false,
    isLive = false,
    iconType,
    iconStyle,
    className = "",
    onClick,
    children,
}: DrawerNavButtonProps) => {
    const active = isActive ? "bg-gray-700" : "";
    return (
        <button
            className={`flex w-full items-center justify-between py-2 px-3 text-white hover:bg-gray-900 ${active} ${className}`}
            onClick={onClick}
        >
            <div className="flex items-center gap-1">
                {iconType ? (
                    <Icon
                        type={iconType}
                        iconStyle={iconStyle}
                        size="xs"
                        className="mb-0.5 text-gray-50"
                    />
                ) : null}
                <Text span size="sm" className="font-medium">
                    {children}
                </Text>
            </div>
            {isLive && <LiveIndicator />}
        </button>
    );
};

export default DrawerNavButton;

const LiveIndicator = () => (
    <div className="flex h-4 w-4 items-center justify-center">
        <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white" />
            <span className="relative box-border inline-flex h-full w-full rounded-full border-[1.25px] border-white bg-green-400" />
        </span>
    </div>
);
