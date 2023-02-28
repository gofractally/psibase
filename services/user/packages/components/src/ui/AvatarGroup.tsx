import React from "react";

import { Avatar, AvatarData, AvatarStyleProps } from "./Avatar";
import { AvaconGroup } from "./avacon-components";

export interface AvatarGroupProps extends AvatarStyleProps {
    avatars: AvatarData[];
}

/**
 * `Hexicon` and `Avatar` share layout and other properties. These shared resources are labeled as `Avacon` resources in the code.
 *
 * ⚠️ Avatar keys will likely need to include something more unique, like an account name.
 * And if multiple groups containing the same member feature on the same page, we'll need to pass
 * in a unique key to the group to differentiate those too.
 */
export const AvatarGroup = ({
    avatars,
    size = "base",
    className = "",
    shadow = false,
    shape = "hex",
}: AvatarGroupProps) => {
    return (
        <AvaconGroup avacons={avatars} size={size} className={className}>
            {(avatar) => (
                <Avatar
                    shape={shape}
                    size={size}
                    statusBadge="none"
                    shadow={shadow}
                    {...(avatar as AvatarData)}
                />
            )}
        </AvaconGroup>
    );
};

export default AvatarGroup;
