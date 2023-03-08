import React from "react";

import { AvaconSize, HexiconOutline, HexiconSolid } from "./avacon-components";
import { IconSize, IconStyle, IconType } from "./Icon";

// TODO: Is there a hover style?

export interface HexiconStyle {
    size?: AvaconSize;
    shadow?: boolean;
    outline?: boolean;
}

export interface HexiconIcon {
    bgColorClass: string;
    iconType: IconType;
    iconShade?: "dark" | "light";
    iconStyle?: IconStyle;
    iconClass?: string;
}

export type HexiconProps = HexiconStyle & HexiconIcon;

export const ICON_SIZE_BY_AVACON_SIZE: { [key in AvaconSize]: IconSize } = {
    xs: "xs",
    sm: "xs",
    base: "sm",
    lg: "base",
    xl: "lg",
    "2xl": "lg",
    "3xl": "xl",
    "4xl": "3xl",
    "5xl": "4xl",
};

/**
 * `Hexicon` and `Avatar` share layout and other properties. These shared resources are labeled as `Avacon` resources in the code.
 *
 * This component does not currently have a round variant (as opposed to hex) like its cousin `Avatar`.
 * We could always add that in the future if we want it.
 *
 * ℹ️ `shadow`, `bgColorClass` and `iconShade` do nothing when `outline={true}`.
 */
export const Hexicon = (props: HexiconProps) => {
    if (props.outline) return <HexiconOutline {...props} />;
    return <HexiconSolid {...props} />;
};

export default Hexicon;
