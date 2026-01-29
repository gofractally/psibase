import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";
import { ErrorCard } from "@shared/components/error-card";

import { LoadingSkeleton } from "./components/loading-skeleton";
import { PermissionPrompt } from "./components/permission-prompt";
import { zPermissionRequest } from "./types";

export const App = () => {
    const { data, isPending, error } = useQuery({
        queryKey: ["permissions", "getContext"],
        queryFn: async () => {
            const result = await supervisor.functionCall({
                service: "permissions",
                intf: "admin",
                method: "getContext",
                params: [],
            });
            return zPermissionRequest.parse(result);
        },
    });

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            {error ? (
                <ErrorCard
                    error={error instanceof Error ? error : new Error(String(error))}
                    title="Error"
                />
            ) : isPending || !data ? (
                <LoadingSkeleton />
            ) : (
                <PermissionPrompt permissionRequest={data} />
            )}
        </div>
    );
};
