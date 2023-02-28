import React from "react";

export const AvatarProfileImage = ({
    url,
    name,
}: {
    url: string;
    name?: string;
}) => (
    <img
        src={url}
        alt={name ? `${name}'s avatar` : undefined}
        draggable={false}
        className="h-full w-full object-cover"
    />
);

export default AvatarProfileImage;
