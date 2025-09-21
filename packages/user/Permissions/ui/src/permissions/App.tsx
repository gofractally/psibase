import { useEffect, useState } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

const supervisor = getSupervisor();

type TrustLevel = "low" | "medium" | "high"; // 'none' and 'max' do not trigger a permissions prompt

type Descriptions = [string, string, string];

type ApprovalDuration = "session" | "permanent";

interface PermissionRequest {
    user: string;
    caller: string;
    callee: string;
    level: TrustLevel;
    descriptions: Descriptions;
}

export const App = () => {
    const [error, setError] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] =
        useState<PermissionRequest | null>(null);
    const [duration, setDuration] = useState<ApprovalDuration>("session");
    const [selectedTrustLevel, setSelectedTrustLevel] =
        useState<TrustLevel>("low");

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

    useEffect(() => {
        if (
            permissionRequest?.level &&
            ["low", "medium", "high"].includes(permissionRequest.level)
        ) {
            setSelectedTrustLevel(permissionRequest.level as TrustLevel);
        }
    }, [permissionRequest]);

    const allow = async () => {
        await supervisor.functionCall({
            service: "permissions",
            intf: "admin",
            method: "approve",
            params: [duration],
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
        <div className="mx-auto h-screen w-screen max-w-screen-lg rounded p-6">
            <h3 className="text-4xl">Authorize application</h3>
            <p>
                <b>{permissionRequest.caller}</b> app wants to use the{" "}
                <b>{permissionRequest.callee}</b> app on behalf of{" "}
                <b>{permissionRequest.user}</b>.
            </p>

            <div className="my-4">
                <p className="mb-2 font-medium">
                    Requested trust level:{" "}
                    {permissionRequest.level.charAt(0).toUpperCase() +
                        permissionRequest.level.slice(1)}
                </p>
                <div className="flex gap-2">
                    {["low", "medium", "high"].map((level, index) => {
                        const description =
                            permissionRequest.descriptions[index];
                        if (!description || description.trim() === "") {
                            // Only show trust levels that have non-empty descriptions
                            return null;
                        }

                        const levelLabel =
                            level.charAt(0).toUpperCase() + level.slice(1);

                        return (
                            <button
                                key={level}
                                onClick={() =>
                                    setSelectedTrustLevel(level as TrustLevel)
                                }
                                className={`flex h-12 min-w-[60px] cursor-pointer items-center justify-center rounded border px-3 text-sm font-medium ${
                                    level === selectedTrustLevel
                                        ? "border-blue-500 bg-blue-100 text-blue-700"
                                        : "border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50"
                                }`}
                            >
                                {levelLabel}
                            </button>
                        );
                    })}
                </div>
            </div>

            {permissionRequest.descriptions && (
                <div className="my-4 rounded border border-yellow-200 bg-yellow-50 p-3">
                    <div>
                        <p className="whitespace-pre-line text-yellow-700">
                            {selectedTrustLevel === "low"
                                ? permissionRequest.descriptions[0]
                                : selectedTrustLevel === "medium"
                                  ? permissionRequest.descriptions[1]
                                  : permissionRequest.descriptions[2]}
                        </p>
                    </div>
                </div>
            )}

            <div className="my-4">
                <p className="mb-2 font-medium">Duration:</p>
                <div className="space-y-2">
                    <label className="flex items-center">
                        <input
                            type="radio"
                            name="duration"
                            value="session"
                            checked={duration === "session"}
                            onChange={(e) =>
                                setDuration(e.target.value as ApprovalDuration)
                            }
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
                            onChange={(e) =>
                                setDuration(e.target.value as ApprovalDuration)
                            }
                            className="mr-2"
                        />
                        Permanently (unless updated/deleted later)
                    </label>
                </div>
            </div>

            {!!error && <div>ERROR: {error}</div>}

            <p className="mt-2 text-sm text-gray-500">
                By clicking 'Allow', you will{" "}
                {duration === "permanent" ? "permanently grant" : "grant"}{" "}
                <b>{permissionRequest.caller}</b> permission to perform{" "}
                <b>{permissionRequest.level}</b> trust operations within the{" "}
                <b>{permissionRequest.callee}</b> app on your behalf
                {duration === "session"
                    ? " for the remainder of this browser session"
                    : ""}
                .
            </p>

            <div className="mt-4 flex justify-center gap-4">
                <Button onClick={allow}>Allow</Button>
                <Button onClick={cancel}>Cancel</Button>
            </div>
        </div>
    );
};
