import React, { FC, SVGProps } from "react";

import Icon, { IconStyle, IconType } from "./Icon";
import { Illustrations } from "./assets/illustrations";

export type HeaderIllustrationColor =
    | "blue"
    | "darkblue"
    | "gray"
    | "green"
    | "orange"
    | "purple"
    | "yellow";
export type HeaderIllustrationSize = "sm" | "lg";

export interface HeaderIllustrationProps {
    color: HeaderIllustrationColor;
    size: HeaderIllustrationSize;
    icon: IconType;
    iconStyle: IconStyle;
}

type IllustrationsByColorAndSize = {
    [key in HeaderIllustrationColor]: {
        [key in HeaderIllustrationSize]: FC<SVGProps<SVGSVGElement>>;
    };
};

const ILLUSTRATIONS: IllustrationsByColorAndSize = {
    blue: { sm: Illustrations.SmallBlue, lg: Illustrations.LargeBlue },
    darkblue: {
        sm: Illustrations.SmallDarkblue,
        lg: Illustrations.LargeDarkblue,
    },
    gray: { sm: Illustrations.SmallGray, lg: Illustrations.LargeGray },
    green: { sm: Illustrations.SmallGreen, lg: Illustrations.LargeGreen },
    orange: { sm: Illustrations.SmallOrange, lg: Illustrations.LargeOrange },
    purple: { sm: Illustrations.SmallPurple, lg: Illustrations.LargePurple },
    yellow: { sm: Illustrations.SmallYellow, lg: Illustrations.LargeYellow },
};

export const HeaderIllustration = ({
    color,
    size,
    icon,
    iconStyle,
}: HeaderIllustrationProps) => {
    const Illustration = ILLUSTRATIONS[color][size];
    const sizeClass = size === "sm" ? "w-[52px]" : "w-[96px]";
    return (
        <div className="relative flex items-center justify-center">
            <Illustration />
            <div className="absolute inset-0 flex items-center justify-center">
                <Icon
                    type={icon}
                    className={`${sizeClass} text-white`}
                    iconStyle={iconStyle}
                />
            </div>
        </div>
    );
};

export default HeaderIllustration;
