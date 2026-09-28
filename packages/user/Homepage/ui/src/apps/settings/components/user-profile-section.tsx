import { Trash, Upload } from "lucide-react";

import { FormProfile } from "@/components/form-profile";
import { Panel } from "@/components/page-header";

import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useAvatar } from "@shared/hooks/use-avatar";
import { useCacheBust } from "@shared/hooks/use-cache-bust";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { toast } from "@shared/shadcn/ui/sonner";

import { useRemoveAvatar } from "../../contacts/hooks/use-remove-avatar";
import { useSetProfile } from "../../contacts/hooks/use-set-profile";
import { useUploadAvatar } from "../../contacts/hooks/use-upload-avatar";
import { UserProfileSkeleton } from "./user-profile-skeleton";

export const UserProfileSection = () => {
    const { mutateAsync: setProfile, isPending: isSettingProfile } =
        useSetProfile();

    const { mutateAsync: removeAvatar, isPending: isRemovingAvatar } =
        useRemoveAvatar();

    const { setBustedUser } = useCacheBust();

    const { data: currentUser } = useCurrentUser();
    const {
        data: profile,
        isError,
        isLoading,
        isFetching,
        error,
    } = useProfile(currentUser, true, {});
    const { mutateAsync: uploadAvatar, isPending: isUploadingAvatar } =
        useUploadAvatar();

    const isPending = isSettingProfile || isRemovingAvatar || isUploadingAvatar;

    const handleImageChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const file = e.target.files?.[0];
        if (file) {
            const buffer = await file.arrayBuffer();
            await uploadAvatar({
                avatar: {
                    contentType: file.type,
                    content: new Uint8Array(buffer),
                },
            });
            toast.success("Avatar uploaded");

            if (currentUser) {
                setBustedUser(currentUser);
            }
        }
    };

    const { avatarSrc, type } = useAvatar({ account: currentUser });
    const removeImage = async () => {
        await removeAvatar();
    };

    return (
        <Panel
            title="Public profile"
            description="Shown to everyone, in every app on the network"
            className="self-start"
        >
            <div className="bg-muted/20 flex items-center gap-4 border-b px-4 py-4">
                <Avatar
                    account={currentUser || ""}
                    src={avatarSrc}
                    className="bg-card size-20 shrink-0 rounded-xl border-2 object-cover transition-opacity duration-200"
                    style={{ borderColor: colorFor(currentUser || "") }}
                    alt={`Avatar of ${currentUser}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                        <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                            Avatar
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {type === "uploaded"
                                ? "Using your uploaded image."
                                : "Using a generated identicon. Upload an image to replace it."}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isPending}
                        >
                            <label
                                htmlFor="icon-upload"
                                className="cursor-pointer"
                            >
                                <Upload className="size-3.5" />
                                Upload
                            </label>
                        </Button>
                        <Input
                            id="icon-upload"
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                        />
                        {type === "uploaded" && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="hover:text-destructive h-7 text-xs"
                                disabled={isPending}
                                onClick={() => {
                                    removeImage();
                                }}
                            >
                                <Trash className="size-3.5" />
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="p-4">
                {(isLoading || profile === undefined) && (
                    <UserProfileSkeleton />
                )}
                {profile !== undefined && !isFetching && (
                    <FormProfile
                        initialData={profile?.profile ?? undefined}
                        onSubmit={async (data) => {
                            await setProfile({
                                bio: data.bio,
                                displayName: data.displayName,
                            });
                            return data;
                        }}
                    />
                )}
                {isError && (
                    <div className="text-destructive mt-2 text-xs">
                        {error?.message}
                    </div>
                )}
            </div>
        </Panel>
    );
};
