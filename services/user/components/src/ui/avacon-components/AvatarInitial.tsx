import React from "react";
import { AvaconSize, AVACON_SETTINGS } from ".";

export const AvatarInitial = ({
    name,
    size,
}: {
    name: string;
    size: AvaconSize;
}) => {
    const { fontClass } = AVACON_SETTINGS[size];
    return (
        <div className={fontClass + " select-none"}>
            {name.charAt(0).toUpperCase()}
        </div>
    );
};

export default AvatarInitial;
