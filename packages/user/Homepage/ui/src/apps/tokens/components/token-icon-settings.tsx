import type { Token } from "../hooks/tokens-plugin/use-user-token-balances";

import { Trash, Upload } from "lucide-react";
import { useId } from "react";

import { Panel } from "@/components/page-header";

import { TokenIcon } from "@shared/components/token-icon";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";

import {
    useRemoveTokenIcon,
    useSetTokenIcon,
} from "../hooks/tokens-plugin/use-token-icon";

export const TokenIconSettings = ({
    token,
    currentUser,
    proposeAs,
}: {
    token: Token;
    currentUser: string | null;
    /** Token owner to propose changes on behalf of, when the current user isn't the owner */
    proposeAs?: string;
}) => {
    const inputId = useId();
    const { mutate: setIcon, isPending: isSetting } =
        useSetTokenIcon(currentUser);
    const { mutate: removeIcon, isPending: isRemoving } =
        useRemoveTokenIcon(currentUser);
    const isPending = isSetting || isRemoving;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) {
            setIcon({ tokenId: token.id, file, proposeAs });
        }
    };

    return (
        <Panel
            title="Token icon"
            description={
                proposeAs
                    ? `${token.label} is owned by ${proposeAs}. Changes are proposed on its behalf and take effect once approved.`
                    : `You own ${token.label}. Its icon is shown in every app on the network.`
            }
        >
            <div className="flex items-center gap-4 px-4 py-3">
                <TokenIcon
                    tokenId={token.id}
                    icon={token.icon}
                    className="size-12"
                    alt={`Icon of ${token.label}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="text-muted-foreground text-xs">
                        {token.icon
                            ? "Using your uploaded icon."
                            : "Using a generated icon. Upload an image to replace it; it is cropped to a centered square of at most 256×256."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isPending}
                        >
                            <label htmlFor={inputId} className="cursor-pointer">
                                <Upload className="size-3.5" />
                                Upload
                            </label>
                        </Button>
                        <Input
                            id={inputId}
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            disabled={isPending}
                            className="hidden"
                        />
                        {token.icon && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="hover:text-destructive h-7 text-xs"
                                disabled={isPending}
                                onClick={() =>
                                    removeIcon({ tokenId: token.id, proposeAs })
                                }
                            >
                                <Trash className="size-3.5" />
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </Panel>
    );
};
