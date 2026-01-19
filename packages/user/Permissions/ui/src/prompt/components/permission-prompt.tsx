import type { ApprovalDuration, PermissionRequest } from "../types";

import { useState } from "react";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { supervisor } from "@shared/lib/supervisor";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
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

import { levelStyles } from "./level-styles";
import { LevelBadge } from "./permission-level-badge";

interface Props {
    permissionRequest: PermissionRequest;
}

export const PermissionPrompt = ({ permissionRequest }: Props) => {
    const [duration, setDuration] = useState<ApprovalDuration>("session");

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
                <div className="space-y-2">
                    <Label>
                        {permissionRequest.level === "low" ? "Requested trust level:" : "Requested trust levels:"}
                        <span className="space-x-1">
                            {levelStyles[permissionRequest.level].requestedLevels.map((level) => (
                                <LevelBadge key={level} level={level} />
                            ))}</span>
                    </Label>
                    {levelStyles[permissionRequest.level].requestedLevels.map(
                        (levelLabel) => {
                            const level = levelStyles[levelLabel];
                            const description =
                                permissionRequest.descriptions[level.descriptionIndex];
                            // Only show trust levels that have non-empty descriptions
                            if (!description || description.trim() === "") {
                                return null;
                            }

                            return (
                                <Alert
                                    key={`${level}-info-alert`}
                                    data-level={level}
                                    variant={
                                        level.alertVariant
                                    }
                                >
                                    {level.icon}
                                    <AlertTitle className="-mt-px mb-0.5">
                                        <LevelBadge level={levelLabel} />{" "}grants the following abilities:
                                    </AlertTitle>
                                    <AlertDescription className="whitespace-pre-line">
                                        {description}
                                    </AlertDescription>
                                </Alert>
                            );
                        },
                    )}</div>

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

                <CardDescription className="text-sm">
                    By clicking 'Allow', you will{" "}
                    {duration === "permanent" ? "permanently grant" : "grant"}{" "}
                    <span className="text-foreground font-semibold">
                        {permissionRequest.caller}
                    </span>{" "}
                    permission to perform these operations within the{" "}
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
                    Trust {permissionRequest.caller}
                </Button>
                <Button onClick={cancel} variant="outline" size="lg">
                    Cancel
                </Button>
            </CardFooter>
        </BrandedGlowingCard>
    );
};
