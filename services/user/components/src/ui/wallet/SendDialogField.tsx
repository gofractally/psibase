import React from "react";
import { Avatar } from "../Avatar";

interface FieldProps {
    children: React.ReactNode | React.ReactNode[];
    avatar?: {
        url?: string;
        name?: string;
    };
    onClick?: () => void;
}

const SendDialogField = ({ children, avatar, onClick }: FieldProps) => {
    return (
        <div
            className={`SendDialogField mb-4 flex gap-1 border border-gray-200 px-2 py-1 ${
                onClick && "cursor-pointer"
            }`}
            onClick={onClick}
        >
            {avatar && (
                <div className="mt-3 flex-none">
                    <Avatar
                        avatarUrl={avatar.url}
                        name="Rey"
                        size="lg"
                        shape="hex"
                    />
                </div>
            )}
            <div className="mx-1 my-auto flex-auto content-center">
                <div
                    className={`contentLen-${
                        Array.isArray(children) ? children.length : 0
                    } text-sm`}
                >
                    {children}
                </div>
            </div>
            {onClick && (
                <div className="mx-2 my-auto flex-none content-center text-gray-400">
                    &gt;
                </div>
            )}
        </div>
    );
};

export default SendDialogField;
