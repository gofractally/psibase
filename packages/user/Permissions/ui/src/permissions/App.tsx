import { useEffect, useState } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";

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
        return (
            <div className="flex min-h-screen items-center justify-center p-6">
                <BrandedGlowingCard>
                    <CardContent>
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    </CardContent>
                </BrandedGlowingCard>
            </div>
        );
    } else if (!permissionRequest) {
        return (
            <div className="flex min-h-screen items-center justify-center p-6">
                <BrandedGlowingCard>
                    <CardContent>
                        <div className="text-muted-foreground text-center">
                            Loading...
                        </div>
                    </CardContent>
                </BrandedGlowingCard>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <BrandedGlowingCard>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <CardTitle className="text-2xl">
                            Authorize Application
                        </CardTitle>
                        <CardDescription className="text-base">
                            <span className="text-foreground font-semibold">
                                {permissionRequest.caller}
                            </span>{" "}
                            app wants to use the{" "}
                            <span className="text-foreground font-semibold">
                                {permissionRequest.callee}
                            </span>{" "}
                            app on behalf of{" "}
                            <span className="text-foreground font-semibold">
                                {permissionRequest.user}
                            </span>
                            .
                        </CardDescription>
                    </div>

                    <div className="space-y-3">
                        <Label className="text-base font-medium">
                            Requested trust level:{" "}
                            <span className="capitalize">
                                {permissionRequest.level}
                            </span>
                        </Label>
                        <div className="flex flex-wrap gap-2">
                            {["low", "medium", "high"].map((level, index) => {
                                const description =
                                    permissionRequest.descriptions[index];
                                // Only show trust levels that have non-empty descriptions
                                if (!description || description.trim() === "") {
                                    return null;
                                }

                                const levelLabel =
                                    level.charAt(0).toUpperCase() +
                                    level.slice(1);
                                const isSelected = level === selectedTrustLevel;

                                return (
                                    <Button
                                        key={level}
                                        onClick={() =>
                                            setSelectedTrustLevel(
                                                level as TrustLevel,
                                            )
                                        }
                                        variant={
                                            isSelected ? "default" : "outline"
                                        }
                                        className={`min-w-[80px] ${
                                            isSelected
                                                ? "shadow-md"
                                                : "hover:bg-accent"
                                        }`}
                                    >
                                        {levelLabel}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>

                    {permissionRequest.descriptions && (
                        <Alert className="border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20">
                            <AlertDescription className="whitespace-pre-line text-yellow-800 dark:text-yellow-200">
                                {selectedTrustLevel === "low"
                                    ? permissionRequest.descriptions[0]
                                    : selectedTrustLevel === "medium"
                                      ? permissionRequest.descriptions[1]
                                      : permissionRequest.descriptions[2]}
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-3">
                        <Label className="text-base font-medium">
                            Duration
                        </Label>
                        <RadioGroup
                            value={duration}
                            onValueChange={(value: string) =>
                                setDuration(value as ApprovalDuration)
                            }
                            className="space-y-3"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="session" id="session" />
                                <Label
                                    htmlFor="session"
                                    className="cursor-pointer font-normal"
                                >
                                    For this session
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem
                                    value="permanent"
                                    id="permanent"
                                />
                                <Label
                                    htmlFor="permanent"
                                    className="cursor-pointer font-normal"
                                >
                                    Permanently (unless updated/deleted later)
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {!!error && (
                        <Alert variant="destructive">
                            <AlertDescription>ERROR: {error}</AlertDescription>
                        </Alert>
                    )}

                    <CardDescription className="text-sm">
                        By clicking 'Allow', you will{" "}
                        {duration === "permanent"
                            ? "permanently grant"
                            : "grant"}{" "}
                        <span className="text-foreground font-semibold">
                            {permissionRequest.caller}
                        </span>{" "}
                        permission to perform{" "}
                        <span className="text-foreground font-semibold">
                            {permissionRequest.level}
                        </span>{" "}
                        trust operations within the{" "}
                        <span className="text-foreground font-semibold">
                            {permissionRequest.callee}
                        </span>{" "}
                        app on your behalf
                        {duration === "session"
                            ? " for the remainder of this browser session"
                            : ""}
                        .
                    </CardDescription>
                </CardContent>

                <CardFooter className="flex justify-center gap-4">
                    <Button onClick={allow} size="lg">
                        Allow
                    </Button>
                    <Button onClick={cancel} variant="outline" size="lg">
                        Cancel
                    </Button>
                </CardFooter>
            </BrandedGlowingCard>
        </div>
    );
};
