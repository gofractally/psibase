import { useEffect, useState } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

const supervisor = getSupervisor();

interface PermissionRequest {
    user: string;
    caller: string;
    callee: string;
    trustLevel: number;
    description: string;
}

export const App = () => {
    const [error, setError] = useState<string | null>(null);
    const [contextId, setContextId] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] =
        useState<PermissionRequest | null>(null);
    const [duration, setDuration] = useState<string>("session");

    useEffect(() => {
        const handleError = (error: string) => {
            setError("Permissions request error: " + error);
        };

        const initApp = async () => {
            const cid = prompt.getContextId();
            if (!cid) {
                return handleError("No context id provided");
            }
            setContextId(cid);

            try {
                setPermissionRequest(
                    (await supervisor.functionCall({
                        service: "permissions",
                        intf: "admin",
                        method: "getContext",
                        params: [cid],
                    })) as PermissionRequest,
                );
            } catch {
                return handleError("Failed to get context");
            }
        };

        initApp();
    }, []);

    const allow = async () => {
        await supervisor.functionCall({
            service: "permissions",
            intf: "admin",
            method: "approve",
            params: [contextId, duration],
        });
        prompt.finished();
    };

    const cancel = async () => {
        prompt.finished();
    };

    if (error) {
        return <div>{error}</div>;
    } else if (!permissionRequest) {
        return <div>Loading...</div>;
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg rounded border border-gray-200 p-6">
            <h3 className="text-4xl">Authorize application</h3>
            <p>
                <b>{permissionRequest.caller}</b> app wants to use the{" "}
                <b>{permissionRequest.callee}</b> app on behalf of{" "}
                <b>{permissionRequest.user}</b>.
            </p>

            {permissionRequest.description && (
                <div className="my-4 rounded border border-yellow-200 bg-yellow-50 p-3">
                    <p className="whitespace-pre-line text-yellow-700">
                        By authorizing, you trust{" "}
                        <b>{permissionRequest.caller}</b> with these abilities:
                        <br />
                        {permissionRequest.description}
                    </p>
                </div>
            )}

            {/* trust level widget */}
            <div className="my-4">
                <p className="mb-2 font-medium">Trust Level:</p>
                <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                        <div
                            key={level}
                            className={`flex h-8 w-8 items-center justify-center rounded border text-sm font-medium ${
                                level === permissionRequest.trustLevel
                                    ? "border-blue-500 bg-blue-100 text-blue-700"
                                    : "border-gray-300 text-gray-500"
                            }`}
                        >
                            {level}
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-sm text-gray-500">
                    Make sure that you have at least{" "}
                    {
                        {
                            1: "low",
                            2: "medium",
                            3: "high",
                            4: "very high",
                            5: "extremely high",
                        }[permissionRequest.trustLevel]
                    }{" "}
                    trust in <b>{permissionRequest.caller}</b>.
                </p>
            </div>

            <div className="my-4">
                <p className="mb-2 font-medium">Duration:</p>
                <div className="space-y-2">
                    <label className="flex items-center">
                        <input
                            type="radio"
                            name="duration"
                            value="session"
                            checked={duration === "session"}
                            onChange={(e) => setDuration(e.target.value)}
                            className="mr-2"
                        />
                        For this session
                    </label>
                    <label className="flex items-center">
                        <input
                            type="radio"
                            name="duration"
                            value="permanent"
                            checked={duration === "permanent"}
                            onChange={(e) => setDuration(e.target.value)}
                            className="mr-2"
                        />
                        Permanently (unless updated/deleted later)
                    </label>
                </div>
            </div>

            {!!error && <div>ERROR: {error}</div>}
            <div className="flex justify-center gap-4">
                <Button onClick={allow}>Allow</Button>
                <Button onClick={cancel}>Cancel</Button>
            </div>
        </div>
    );
};
