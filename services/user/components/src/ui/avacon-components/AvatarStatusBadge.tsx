import React from "react";

import { AvaconSize, AVACON_SETTINGS } from ".";

export type AvatarStatusBadgeStyle =
    | "green"
    | "yellow"
    | "red"
    | "gray"
    | "none";

const STATUS_BADGES: {
    [key in AvatarStatusBadgeStyle]: string;
} = {
    green: "bg-green-500",
    yellow: "bg-orange-500",
    red: "bg-red-500",
    gray: "bg-gray-200",
    none: "transparent,",
};

export const AvatarStatusBadge = ({
    badge,
    shadow,
    size,
}: {
    badge: AvatarStatusBadgeStyle;
    shadow: boolean;
    size: AvaconSize;
}) => {
    if (badge === "none") return null;

    const { shadowClass, width } = AVACON_SETTINGS[size];
    const dropShadow = shadow ? shadowClass : "";
    const statusBadgeClass = `absolute inline-block transform translate-x-1/2 rounded-full outline outline-white ${STATUS_BADGES[badge]}`;

    return (
        <span
            className={`${statusBadgeClass} ${dropShadow}`}
            style={{
                width: width * 0.21875,
                height: width * 0.21875,
                outlineWidth: width * 0.05,
                bottom: width * 0.05 - 1,
                right: "15%",
            }}
        ></span>
    );
};

export default AvatarStatusBadge;
