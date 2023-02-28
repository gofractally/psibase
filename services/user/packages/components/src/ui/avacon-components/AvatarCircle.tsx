import React from "react";
import {
    AVACON_SETTINGS,
    AvatarInitial,
    AvatarProfileImage,
    AvatarAnonVector,
    AvatarStatusBadge,
} from ".";
import { AvatarProps } from "../Avatar";

export const AvatarCircle = ({
    name,
    avatarUrl,
    size = "base",
    className = "",
    statusBadge = "none",
    shadow = false,
}: AvatarProps) => {
    const { shadowClass, width } = AVACON_SETTINGS[size];
    const dropShadow = shadow ? shadowClass : "";

    return (
        <div className="relative inline-block">
            <div
                className={`${className} ${dropShadow} relative flex items-center justify-center overflow-hidden rounded-full border-white bg-gray-400 text-white`}
                style={{ width, height: width, borderWidth: width * 0.05 }}
            >
                {avatarUrl ? (
                    <AvatarProfileImage url={avatarUrl} name={name} />
                ) : name ? (
                    <AvatarInitial name={name} size={size} />
                ) : (
                    <AvatarAnonVector hex={false} />
                )}
            </div>
            <AvatarStatusBadge
                badge={statusBadge}
                shadow={shadow}
                size={size}
            />
        </div>
    );
};

export default AvatarCircle;
