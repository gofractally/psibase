import { Trash, Upload } from "lucide-react";

import { FormProfile } from "@/components/form-profile";

import { useCacheBust } from "@/hooks/use-cache-bust";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfile } from "@/hooks/use-profile";

import { Avatar } from "@shared/components/avatar";
import { useAvatar } from "@shared/hooks/use-avatar";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { toast } from "@shared/shadcn/ui/sonner";

import { useRemoveAvatar } from "../../contacts/hooks/use-remove-avatar";
import { useSetProfile } from "../../contacts/hooks/use-set-profile";
import { useUploadAvatar } from "../../contacts/hooks/use-upload-avatar";

export const UserProfileSection = () => {
    const { mutateAsync: setProfile, isPending: isSettingProfile } =
        useSetProfile();

    const { mutateAsync: removeAvatar, isPending: isRemovingAvatar } =
        useRemoveAvatar();

    const { setBustedUser } = useCacheBust();

    const { data: currentUser } = useCurrentUser();
    const {
        data: profile,
        isSuccess,
        isError,
        isLoading,
        isFetching,
        error,
    } = useProfile(currentUser);
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
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold mb-2">User Profile</h2>
                <p className="text-muted-foreground text-sm">
                    All information is public.
                </p>
            </div>

            <div className="flex items-center justify-between space-x-4">
                <Avatar
                    account={currentUser || ""}
                    src={avatarSrc}
                    className="h-24 w-24 transition-opacity duration-200"
                    alt={`Avatar of ${currentUser}`}
                />
                <div className="flex flex-1 flex-col justify-center gap-2">
                    <div>
                        <Button asChild disabled={isPending}>
                            <label
                                htmlFor="icon-upload"
                                className="cursor-pointer"
                            >
                                <Upload className="mr-2 h-5 w-5" />
                                Upload avatar
                            </label>
                        </Button>
                        <Input
                            id="icon-upload"
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                        />
                    </div>
                    <div>
                        {type === "uploaded" && (
                            <Button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                    removeImage();
                                }}
                                variant="destructive"
                            >
                                <Trash className="mr-2 h-5 w-5" />
                                Delete avatar
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {(isLoading || (profile === undefined)) && (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-4 w-full max-w-md" />
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-4 w-full max-w-md" />
                    </div>
                    <Skeleton className="h-10 w-32" />
                </div>
            )}
            {profile !== undefined && !isFetching && (
                <FormProfile
                    initialData={profile?.profile || undefined}
                    onSubmit={async (data) => {
                        await setProfile({
                            bio: data.bio,
                            displayName: data.displayName,
                        });
                        toast.success("Profile updated");
                        return data;
                    }}
                />
            )}
            {isError && (
                <div className="text-destructive">{error?.message}</div>
            )}
        </div>
    );
};
