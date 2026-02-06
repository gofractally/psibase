import type { ApprovalDuration, PermissionRequest } from "../types";

import { useMutation } from "@tanstack/react-query";
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
import { ErrorCard } from "@shared/components/error-card";

import { levelStyles } from "./level-styles";
import { LevelBadge } from "./permission-level-badge";
import { AccountName } from "./account-name";
import { zApprovalDuration } from "../types";

interface Props {
    permissionRequest: PermissionRequest;
}

export const PermissionPrompt = ({ permissionRequest }: Props) => {
    const [duration, setDuration] = useState<ApprovalDuration>("session");

    const approveMutation = useMutation({
        mutationKey: ["permissions", "approve"],
        mutationFn: async (duration: ApprovalDuration) => {
            zApprovalDuration.parse(duration);
            await supervisor.functionCall({
                service: "permissions",
                intf: "admin",
                method: "approve",
                params: [duration],
            });
        },
        onSuccess: () => {
            prompt.finished();
        },
    });

    const cancel = async () => {
        prompt.finished();
    };

    if (approveMutation.isError) {
        return <ErrorCard error={approveMutation.error} />;
    }

    return (
        <BrandedGlowingCard>
            <CardHeader>
                <CardTitle className="text-3xl font-normal">
                    Authorize Application
                </CardTitle>
                <CardDescription>
                    The{" "}
                    <AccountName type="app">{permissionRequest.caller}</AccountName>{" "}
                    app wants to use the{" "}
                    <AccountName type="app">{permissionRequest.callee}</AccountName>{" "}
                    app on behalf of{" "}
                    <AccountName type="account">{permissionRequest.user}</AccountName>.
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
                    By clicking <span className="italic text-foreground">Trust {permissionRequest.caller} app</span>, you will{" "}
                    {duration === "permanent" ? "permanently grant " : "grant "}
                    <AccountName type="app">{permissionRequest.caller}</AccountName>{" "}
                    permission to perform these operations within the{" "}
                    <AccountName type="app">{permissionRequest.callee}</AccountName>{" "}
                    app on your behalf
                    {duration === "session"
                        ? " for the remainder of this browser session."
                        : "."}
                </CardDescription>
            </CardContent>

            <CardFooter className="flex justify-center gap-4">
                <Button
                    onClick={() => approveMutation.mutate(duration)}
                    disabled={approveMutation.isPending}
                    size="lg"
                >
                    Trust {permissionRequest.caller} app
                </Button>
                <Button onClick={cancel} variant="outline" size="lg">
                    Cancel
                </Button>
            </CardFooter>
        </BrandedGlowingCard>
    );
};
