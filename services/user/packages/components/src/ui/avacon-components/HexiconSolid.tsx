import React from "react";

import { AvaconContainer } from ".";
import { HexiconProps, Icon, ICON_SIZE_BY_AVACON_SIZE } from "..";

export const HexiconSolid = ({
    size = "base",
    shadow = false,
    bgColorClass = "bg-gray-400",
    iconType = "f",
    iconShade = "light",
    iconStyle = "outline",
    iconClass = "",
}: HexiconProps) => {
    const iconSize = ICON_SIZE_BY_AVACON_SIZE[size];
    const iconFill = iconShade === "light" ? "text-white" : "text-black";
    return (
        <AvaconContainer
            bgColorClass={bgColorClass}
            size={size}
            shadow={shadow}
        >
            <Icon
                type={iconType}
                size={iconSize}
                iconStyle={iconStyle}
                className={`${iconFill} ${iconClass}`}
            />
        </AvaconContainer>
    );
};

export default HexiconSolid;
