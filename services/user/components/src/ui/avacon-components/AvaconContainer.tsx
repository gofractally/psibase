import React from "react";

import {
    AVACON_SETTINGS,
    AvaconSize,
    AvaconBackplate,
    AvatarStatusBadgeStyle,
    AvatarStatusBadge,
} from ".";

type Props = {
    size: AvaconSize;
    shadow: boolean;
    bgColorClass?: string;
    statusBadge?: AvatarStatusBadgeStyle;
    children: React.ReactNode;
};

/**
 * This component provides layout for both `<Avatar />` and `<Hexicon />` components.
 */
export const AvaconContainer = ({
    size,
    shadow,
    bgColorClass = "bg-gray-400",
    statusBadge = "none",
    children,
}: Props) => {
    const { width } = AVACON_SETTINGS[size];
    const aspectRatio = "32 / 29.33";
    return (
        <div className="relative inline-block">
            <AvaconBackplate size={size} shadow={shadow} />
            <div className="absolute inset-0 flex items-center justify-center">
                <div
                    className={`flex items-center justify-center ${bgColorClass}`}
                    style={{ clipPath: "url(#hex-mask)", width, aspectRatio }}
                >
                    {children}
                </div>
            </div>
            <AvatarStatusBadge
                badge={statusBadge}
                shadow={shadow}
                size={size}
            />
        </div>
    );
};

export default AvaconContainer;
