import React from "react";

import { AVACON_SETTINGS } from ".";
import { AvatarData, AvatarStyleProps } from "../Avatar";
import { HexiconIcon } from "../Hexicon";

export interface AvaconGroupProps extends AvatarStyleProps {
    avacons: HexiconIcon[] | AvatarData[];
    children: (icon: HexiconIcon | AvatarData) => JSX.Element;
}

/**
 * `Hexicon` and `Avatar` share layout and other properties. These shared resources are labeled as `Avacon` resources in the code.
 *
 * ⚠️ If multiple groups containing the same icon feature on the same page, we'll need to pass
 * in a unique key to the group to differentiate those.
 */
export const AvaconGroup = ({
    avacons,
    size = "base",
    className = "",
    children,
}: AvaconGroupProps) => {
    return (
        <div className={`relative block ${className}`}>
            {avacons.map((avacon: HexiconIcon | AvatarData, index) => {
                const { width } = AVACON_SETTINGS[size];
                let key;
                if ("iconType" in avacon) {
                    key = `hexicon-group-${avacon.iconType}`;
                } else {
                    key = `avatar-group-${avacon.name ?? avacon.avatarUrl}`;
                }
                return (
                    <div
                        className={index ? "absolute" : ""}
                        style={{ top: 0, left: width * 0.7 * index }}
                        key={key}
                    >
                        {children(avacon)}
                    </div>
                );
            })}
        </div>
    );
};

export default AvaconGroup;
