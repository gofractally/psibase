import type { PermissionRequest } from "./types";

import { useEffect, useState } from "react";

import { supervisor } from "@shared/lib/supervisor";

import { ErrorCard } from "./error-card";
import { LoadingSkeleton } from "./loading-skeleton";
import { PermissionPrompt } from "./permission-prompt";

export const App = () => {
    const [error, setError] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] =
        useState<PermissionRequest | null>(null);

    useEffect(() => {
        const handleError = (error: string) => {
            setError("Permissions request error: " + error);
        };

        const initApp = async () => {
            try {
                setPermissionRequest(
                    (await supervisor.functionCall({
                        service: "permissions",
                        intf: "admin",
                        method: "getContext",
                        params: [],
                    })) as PermissionRequest,
                );
            } catch {
                return handleError("Failed to get context");
            }
        };

        initApp();
    }, []);

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            {error ? (
                <ErrorCard error={error} />
            ) : !permissionRequest ? (
                <LoadingSkeleton />
            ) : (
                <PermissionPrompt
                    permissionRequest={permissionRequest}
                    error={error}
                />
            )}
        </div>
    );
};
