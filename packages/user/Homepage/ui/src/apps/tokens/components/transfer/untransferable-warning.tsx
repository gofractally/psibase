import { Lock } from "lucide-react";

export const UntransferableTokenWarning = () => {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
            <Lock className="size-3.5 shrink-0" />
            <p className="text-xs font-medium">
                This token is not transferable. You can hold it, but cannot send
                it to other accounts.
            </p>
        </div>
    );
};
