import { Eye, EyeOff } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

interface PasswordVisibilityButtonProps {
    showPassword: boolean;
    onToggle: () => void;
}

export const PasswordVisibilityButton = ({
    showPassword,
    onToggle,
}: PasswordVisibilityButtonProps) => {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggle}
            aria-label={showPassword ? "Hide password" : "Show password"}
        >
            {showPassword ? (
                <EyeOff className="h-4 w-4" />
            ) : (
                <Eye className="h-4 w-4" />
            )}
        </Button>
    );
};
