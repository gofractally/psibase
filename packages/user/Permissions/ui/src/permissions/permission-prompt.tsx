import type { ApprovalDuration, PermissionRequest, TrustLevel } from "./types";

import { useEffect, useState } from "react";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { supervisor } from "@shared/lib/supervisor";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Label } from "@shared/shadcn/ui/label";
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

import { levelStyles } from "./level-styles";
import { LevelBadge } from "./permission-level-badge";

interface Props {
    permissionRequest: PermissionRequest;
    error: string | null;
}

export const PermissionPrompt = ({ permissionRequest, error }: Props) => {
    const [duration, setDuration] = useState<ApprovalDuration>("session");
    const [selectedTrustLevel, setSelectedTrustLevel] =
        useState<TrustLevel>("low");

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

    return (
        <BrandedGlowingCard>
            <CardHeader>
                <CardTitle className="text-3xl font-normal">
                    Authorize Application
                </CardTitle>
                <CardDescription>
                    The{" "}
                    <span className="text-foreground font-medium">
                        {permissionRequest.caller}
                    </span>{" "}
                    app wants to use the{" "}
                    <span className="text-foreground font-medium">
                        {permissionRequest.callee}
                    </span>{" "}
                    app on behalf of{" "}
                    <span className="text-foreground font-medium">
                        {permissionRequest.user}
                    </span>
                    .
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <Label>
                    Requested trust level:{" "}
                    <LevelBadge level={permissionRequest.level} />
                </Label>
                <Tabs
                    value={selectedTrustLevel}
                    onValueChange={(value) =>
                        setSelectedTrustLevel(value as TrustLevel)
                    }
                >
                    <TabsList>
                        {["low", "medium", "high"].map((level, index) => {
                            const description =
                                permissionRequest.descriptions[index];
                            // Only show trust levels that have non-empty descriptions
                            if (!description || description.trim() === "") {
                                return null;
                            }

                            return (
                                <TabsTrigger
                                    key={level}
                                    value={level}
                                    className="capitalize"
                                >
                                    {level}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                    {(["low", "medium", "high"] as TrustLevel[]).map(
                        (level, index) => {
                            const description =
                                permissionRequest.descriptions[index];
                            // Only show trust levels that have non-empty descriptions
                            if (!description || description.trim() === "") {
                                return null;
                            }

                            return (
                                <TabsContent key={level} value={level}>
                                    <Alert
                                        variant={
                                            levelStyles[level].alertVariant
                                        }
                                    >
                                        {levelStyles[level].icon}
                                        <AlertDescription className="whitespace-pre-line">
                                            {description}
                                        </AlertDescription>
                                    </Alert>
                                </TabsContent>
                            );
                        },
                    )}
                </Tabs>

                <div className="space-y-3">
                    <Label className="text-base font-medium">Duration</Label>
                    <RadioGroup
                        value={duration}
                        onValueChange={(value: string) =>
                            setDuration(value as ApprovalDuration)
                        }
                    >
                        <div className="flex items-center gap-3">
                            <RadioGroupItem value="session" id="session" />
                            <Label
                                htmlFor="session"
                                className="cursor-pointer font-normal"
                            >
                                For this session
                            </Label>
                        </div>
                        <div className="flex items-center gap-3">
                            <RadioGroupItem value="permanent" id="permanent" />
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
                    {duration === "permanent" ? "permanently grant" : "grant"}{" "}
                    <span className="text-foreground font-semibold">
                        {permissionRequest.caller}
                    </span>{" "}
                    permission to perform{" "}
                    <LevelBadge level={permissionRequest.level} /> trust
                    operations within the{" "}
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
    );
};
