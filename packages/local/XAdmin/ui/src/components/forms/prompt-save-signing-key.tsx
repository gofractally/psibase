import { useState } from "react";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { pemToB64 } from "@shared/lib/b64-key-utils";
import {
    CardContent,
    CardDescription,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { CopyButton } from "../copy-button";
import { PasswordVisibilityButton } from "../password-visibility-button";

export const PromptSaveSigningKey = ({
    account,
    privateKey,
    didSaveKey,
    setDidSaveKey,
}: {
    account: string;
    privateKey?: string;
    didSaveKey: boolean;
    setDidSaveKey: (didSaveKey: boolean) => void;
}) => {
    const [showPassword, setShowPassword] = useState(false);

    if (!privateKey) {
        return (
            <ErrorCard
                error={new Error("No signing key was provided. Retry boot.")}
            />
        );
    }

    const b64Key = pemToB64(privateKey);

    return (
        <GlowingCard className="w-xl mx-auto">
            <CardContent className="flex flex-col gap-8">
                <div>
                    <CardTitle className="text-3xl font-normal">
                        Secure your block producer account
                    </CardTitle>
                    <CardDescription>
                        Your <span className="font-semibold">Private Key</span>{" "}
                        serves as your account password allowing you to sign
                        into your account from any browser or device.{" "}
                        <span className="font-semibold">
                            Store it safely and securely
                        </span>
                        , as it cannot be recovered if you lose it.
                    </CardDescription>
                </div>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>Account Name</Label>
                        <div className="mb-2 flex gap-2">
                            <div className="relative flex-1">
                                <Input
                                    type="text"
                                    value={account}
                                    readOnly
                                    onFocus={(e) => e.target.select()}
                                />
                                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                    <CopyButton
                                        text={account}
                                        ariaLabel="Copy account name"
                                    />
                                </div>
                            </div>
                        </div>
                        <Label>Private Key</Label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={b64Key}
                                    readOnly
                                    className="pr-20"
                                    onFocus={(e) => e.target.select()}
                                />
                                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                    <PasswordVisibilityButton
                                        showPassword={showPassword}
                                        onToggle={() =>
                                            setShowPassword(!showPassword)
                                        }
                                    />
                                    <CopyButton
                                        text={b64Key}
                                        ariaLabel="Copy private key"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                        <Checkbox
                            id="acknowledge"
                            checked={didSaveKey}
                            onCheckedChange={(checked) =>
                                setDidSaveKey(checked === true)
                            }
                            className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                        />
                        <div className="grid gap-1.5 font-normal">
                            <p className="text-sm font-medium leading-none">
                                Do not lose this!
                            </p>
                            <p className="text-muted-foreground text-sm">
                                I understand that if I lose my private key, I
                                may permanently lose access to my block producer
                                account.
                            </p>
                        </div>
                    </Label>
                </div>
            </CardContent>
        </GlowingCard>
    );
};
