import React from "react";

import Hexicon, { HexiconIcon, HexiconStyle } from "./Hexicon";
import { AvaconGroup } from "./avacon-components";

export interface HexiconGroupProps extends HexiconStyle {
    icons: HexiconIcon[];
    className?: string;
}

/**
 * `Hexicon` and `Avatar` share layout and other properties. These shared resources are labeled as `Avacon` resources in the code.
 *
 * ⚠️ If multiple groups containing the same icon feature on the same page, we'll need to pass
 * in a unique key to the group to differentiate those.
 */
export const HexiconGroup = ({
    icons,
    size = "base",
    className = "",
    shadow = false,
}: HexiconGroupProps) => {
    return (
        <AvaconGroup avacons={icons} size={size} className={className}>
            {(icon) => (
                <Hexicon
                    size={size}
                    shadow={shadow}
                    {...(icon as HexiconIcon)}
                />
            )}
        </AvaconGroup>
    );
};

export default HexiconGroup;
