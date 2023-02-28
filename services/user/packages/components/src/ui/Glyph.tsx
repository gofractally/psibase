import React from "react";

import Icon, { IconStyle, IconType } from "./Icon";
import Loader from "./Loader";

export type GlyphSize = "sm" | "base" | "lg" | "xl";
const SIZES: {
    [key in GlyphSize]: { icon: string; bg: string; chars: string };
} = {
    sm: { icon: "w-3 h-3", bg: "w-auto h-6", chars: "text-md" },
    base: { icon: "w-4 h-4", bg: "w-auto h-8", chars: "text-xl" },
    lg: { icon: "w-5 h-5", bg: "w-auto h-10", chars: "text-2xl" },
    xl: { icon: "w-8 h-8", bg: "w-auto h-12", chars: "text-3xl" },
};
export interface GlyphProps {
    icon?: IconType;
    iconStyle?: IconStyle;
    chars?: string;
    size?: GlyphSize;
    isStatic?: boolean;
    isOutline?: boolean;
    disabled?: boolean;
    isLoading?: boolean;
    dataTestId?: string;
    hex?: boolean;
    color?: string;
    bgColor?: string;
}

/**
 * 🚧 **Deprecated**: Hexicon replaces this component, and is wrapped by components like `<ActionButton />` to provide
 * button-like interactivity.
 *
 * ℹ️ This component takes either a `chars` text prop or an `icon`, as they are defined and enumerated in the `<Icon />`
 * component. If future requirements call for displaying user-generated text or icons within the Glyph, it may make more
 * sense to simply allow the passing in of `children` instead of `chars` and `icon`.
 *
 * ℹ️ The `isStatic` prop may be replaced in the future, with the component instead inferring that by checking for the
 * presence of an anchor tag or `onClick` prop.
 * */
export const Glyph = ({
    chars,
    icon,
    iconStyle,
    size = "base",
    isStatic,
    isOutline,
    disabled,
    isLoading,
    hex,
    color = "text-gray-900",
    bgColor = "bg-gray-100",
}: GlyphProps) => {
    const sizeClass = SIZES[size];
    const colorClass = disabled ? "" : isOutline ? "text-white" : color;
    const bgClass = isOutline ? "bg-blue-600" : bgColor;
    const hoverClass =
        isStatic || disabled || isLoading
            ? "cursor-default"
            : "hover:brightness-90";
    const roundClass = hex ? "" : "rounded-full";
    const hexStyle = hex ? { clipPath: "url(#hex-mask)" } : {};
    const aspectRatio = hex ? "50 / 44" : "1";

    return (
        <span
            className={`mb-1 inline-flex items-center justify-center overflow-hidden ${bgClass} ${colorClass} ${hoverClass} ${sizeClass.bg} ${roundClass}`}
            style={{ ...hexStyle, aspectRatio }}
        >
            {isLoading ? (
                <Loader className="w-2/3" />
            ) : chars ? (
                <span className={sizeClass.chars}>{chars}</span>
            ) : icon ? (
                <Icon
                    type={icon}
                    iconStyle={iconStyle}
                    className={`inline-block ${sizeClass.icon}`}
                />
            ) : null}
        </span>
    );
};

export default Glyph;
