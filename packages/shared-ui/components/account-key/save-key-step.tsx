import { useState } from "react";

import { CopyButton } from "@shared/components/copy-button";
import { DownloadKeyFileButton } from "@shared/components/download-key-file-button";
import { PasswordVisibilityButton } from "@shared/components/password-visibility-button";
import { useBranding } from "@shared/hooks/use-branding";
import { b64ToPem } from "@shared/lib/b64-key-utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

interface SaveKeyStepProps {
    /** Name of the newly created/claimed account. */
    accountName: string;
    /** The account's private key, base64 encoded. */
    keyB64: string;
    onContinue: () => void;
    /** Extra classes for the content area (e.g. "px-0" inside a dialog). */
    contentClassName?: string;
    /** Extra classes for the footer area (e.g. "px-0" inside a dialog). */
    footerClassName?: string;
}

/**
 * Step UI that presents a newly generated private key to the user and
 * requires them to acknowledge they have saved it before continuing.
 */
export const SaveKeyStep = ({
    accountName,
    keyB64,
    onContinue,
    contentClassName,
    footerClassName,
}: SaveKeyStepProps) => {
    const { data: networkName } = useBranding();
    const [showPassword, setShowPassword] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    return (
        <>
            <CardContent
                className={`flex flex-col gap-8 ${contentClassName ?? ""}`}
            >
                <div>
                    <CardTitle className="text-3xl font-normal">
                        Secure your {networkName} account
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
                                    value={accountName}
                                    readOnly
                                    onFocus={(e) => e.target.select()}
                                />
                                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                    <CopyButton
                                        text={accountName}
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
                                    value={keyB64}
                                    readOnly
                                    className="pr-24"
                                    onFocus={(e) => e.target.select()}
                                />
                                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                    <PasswordVisibilityButton
                                        showPassword={showPassword}
                                        onToggle={() =>
                                            setShowPassword(!showPassword)
                                        }
                                    />
                                    <DownloadKeyFileButton
                                        pemContent={b64ToPem(keyB64)}
                                        filename={`${accountName}.pem`}
                                    />
                                    <CopyButton
                                        text={keyB64}
                                        ariaLabel="Copy private key"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                        <Checkbox
                            id="acknowledge"
                            checked={acknowledged}
                            onCheckedChange={(checked) =>
                                setAcknowledged(checked === true)
                            }
                            className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                        />
                        <div className="grid gap-1.5 font-normal">
                            <p className="text-sm font-medium leading-none">
                                Do not lose this!
                            </p>
                            <p className="text-muted-foreground text-sm">
                                I understand that if I lose my private key, I
                                may permanently lose access to my {networkName}{" "}
                                account.
                            </p>
                        </div>
                    </Label>
                </div>
            </CardContent>
            <CardFooter
                className={`flex flex-1 justify-end ${footerClassName ?? ""}`}
            >
                <CardAction>
                    <Button
                        type="button"
                        onClick={onContinue}
                        disabled={!acknowledged}
                    >
                        Continue
                    </Button>
                </CardAction>
            </CardFooter>
        </>
    );
};
