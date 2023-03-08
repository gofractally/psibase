import React from "react";
import {
    AvaconSize,
    AvatarCircle,
    AvatarHex,
    AvatarStatusBadgeStyle,
} from "./avacon-components";

export type AvatarShape = "round" | "hex";

export interface AvatarData {
    name?: string;
    avatarUrl?: string | null;
}

export interface AvatarStyleProps {
    size?: AvaconSize;
    shape?: AvatarShape;
    shadow?: boolean;
    className?: string;
}

export type AvatarProps = AvatarData &
    AvatarStyleProps & { statusBadge?: AvatarStatusBadgeStyle };

/**
 * `Hexicon` and `Avatar` share layout and other properties. These shared resources are labeled as `Avacon` resources in the code.
 *
 * ℹ️ Renders a profile image if present. Otherwise the first letter of the `name` prop, if present. Otherwise, an anon avatar.
 *
 * ℹ️ This component uses a hexagonal SVG with rounded corners to mask the avatar image. This SVG is invisible (takes up no
 * space) and should be loaded once on the page so it can be referenced by as many instances of Avatar require it. In
 * Storybook, this is done in `.storybook/preview-body.html`.
 *
 * ℹ️ This SO answer (and particularly the comment on using `getBox()`) is helpful if we have to tweak or replace the SVG:
 * https://stackoverflow.com/a/40100463
 *
 * While this component has a round variant (vs. hexagonal), the round version isn't officially part of the design system.
 * */
export const Avatar = ({ shape = "hex", ...props }: AvatarProps) => {
    if (shape === "hex") return <AvatarHex {...props} />;
    return <AvatarCircle {...props} />;
};

export default Avatar;
