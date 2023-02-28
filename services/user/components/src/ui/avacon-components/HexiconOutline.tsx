import React from "react";

import { AVACON_SETTINGS } from ".";
import { HexiconProps, Icon, ICON_SIZE_BY_AVACON_SIZE } from "..";

export const HexiconOutline = ({
    size = "base",
    iconType = "f",
    iconStyle = "outline",
    iconClass = "",
}: HexiconProps) => {
    const iconSize = ICON_SIZE_BY_AVACON_SIZE[size];
    const { width } = AVACON_SETTINGS[size];
    const containerWidth = width + width * 0.125;
    return (
        <div
            className="relative flex items-center justify-center text-slate-900"
            style={{
                width: containerWidth,
                height: containerWidth / 1.125,
            }}
        >
            <div style={{ width }}>
                <Icon type="hexagon" iconStyle="outline" />
            </div>
            <Icon
                type={iconType}
                size={iconSize}
                iconStyle={iconStyle}
                className={`absolute ${iconClass}`}
            />
        </div>
    );
};

export default HexiconOutline;
