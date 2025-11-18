import { AlertTriangle } from "lucide-react";

export const UntransferableTokenWarning = () => {
    return (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm font-medium">
                This token is not transferable.
            </p>
        </div>
    );
};
