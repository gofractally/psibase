import { User, UserX } from "lucide-react";

import { Avatar } from "@shared/components/avatar";

export const Contact = ({
    value,
    name,
    userNotFound = false,
    isValid = true,
    isValidating = false,
}: {
    value: string;
    name?: string;
    userNotFound?: boolean;
    isValid?: boolean;
    isValidating?: boolean;
}) => {
    return (
        <div className="flex items-center gap-1.5">
            <UserStartContent
                userNotFound={userNotFound}
                value={value}
                isValid={isValid}
                isValidating={isValidating}
            />
            {name ? (
                <div className="font-normal">
                    <span className="font-medium">{name}</span>{" "}
                    <span className="text-muted-foreground">({value})</span>
                </div>
            ) : (
                <div className="font-normal">{value}</div>
            )}
        </div>
    );
};

const UserStartContent = ({
    userNotFound,
    value,
    isValid,
    isValidating,
}: {
    userNotFound: boolean;
    value: string;
    isValid: boolean;
    isValidating: boolean;
}) => {
    return (
        <div className="flex h-5 w-5 items-center justify-center">
            {isValidating ? (
                <User size={16} />
            ) : userNotFound ? (
                <UserX size={16} className="text-destructive" />
            ) : isValid && value ? (
                <Avatar
                    account={value}
                    className="h-5 w-5"
                    alt="Recipient avatar"
                />
            ) : (
                <User size={16} />
            )}
        </div>
    );
};
