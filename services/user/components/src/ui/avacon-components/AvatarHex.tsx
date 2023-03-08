import React from "react";
import {
    AVACON_SETTINGS,
    AvatarInitial,
    AvatarProfileImage,
    AvatarAnonVector,
} from ".";
import { AvatarProps } from "../Avatar";
import AvaconContainer from "./AvaconContainer";

export const AvatarHex = ({
    name,
    avatarUrl,
    size = "base",
    statusBadge = "none",
    shadow = false,
}: AvatarProps) => {
    const { width } = AVACON_SETTINGS[size];
    const aspectRatio = "32 / 29.33";

    return (
        <AvaconContainer size={size} shadow={shadow} statusBadge={statusBadge}>
            <div className="h-full overflow-hidden" style={{ width }}>
                {avatarUrl ? (
                    <AvatarProfileImage url={avatarUrl} name={name} />
                ) : (
                    <div
                        className="relative flex items-center justify-center bg-gray-400 text-white"
                        style={{ width, aspectRatio }}
                    >
                        {name ? (
                            <AvatarInitial name={name} size={size} />
                        ) : (
                            <AvatarAnonVector hex />
                        )}
                    </div>
                )}
            </div>
        </AvaconContainer>
    );
};

export default AvatarHex;
