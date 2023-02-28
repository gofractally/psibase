import React from "react";

import { AvaconSize, AVACON_SETTINGS } from ".";

export const AvaconBackplate = ({
    size,
    shadow,
}: {
    size: AvaconSize;
    shadow: boolean;
}) => {
    const { shadowClass, width } = AVACON_SETTINGS[size];
    const dropShadow = shadow ? shadowClass : "";
    return (
        <svg
            viewBox="0 0 36 32"
            xmlns="http://www.w3.org/2000/svg"
            fill="white"
            className={dropShadow}
            style={{
                width: width + width * 0.125,
                aspectRatio: "36 / 32",
            }}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M1.16667 13.3951L7.17263 2.79293C8.14656 1.07369 9.95683 0 11.9315 0H23.9435C25.9182 0 27.7284 1.07369 28.7024 2.79293L34.7083 13.3951C35.6806 15.1113 35.6806 17.2221 34.7083 18.9383L28.7024 29.5404C27.7284 31.2596 25.9182 32.3333 23.9435 32.3333H11.9315C9.95683 32.3333 8.14656 31.2596 7.17263 29.5404L1.16667 18.9383C0.194444 17.2221 0.194445 15.1113 1.16667 13.3951Z"
            />
        </svg>
    );
};

export default AvaconBackplate;
