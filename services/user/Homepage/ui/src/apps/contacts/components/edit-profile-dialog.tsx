import { Trash, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DialogDescription } from "@/components/ui/dialog";
import { DialogTitle } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { FormProfile } from "@/components/form-profile";

import { AwaitTime } from "@/globals";
import { useAvatar } from "@/hooks/use-avatar";
import { useCacheBust } from "@/hooks/use-cache-bust";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfile } from "@/hooks/use-profile";

import { useRemoveAvatar } from "../hooks/useRemoveAvatar";
import { useSetProfile } from "../hooks/useSetProfile";
import { useUploadAvatar } from "../hooks/useUploadAvatar";

interface Props {
    onClose: () => void;
}

export const EditProfileDialogContent = ({ onClose }: Props) => {
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
                compressionQuality: 11,
                file: {
                    contentType: file.type,
                    path: "/profile/avatar",
                    content: new Uint8Array(buffer),
                },
            });
            toast.success("Avatar uploaded");

            const isAvatar = !!profile?.profile?.avatar;
            setTimeout(async () => {
                if (currentUser) {
                    setBustedUser(currentUser);
                }
                if (!isAvatar) {
                    await setProfile({
                        avatar: true,
                        displayName: profile?.profile?.displayName ?? "",
                        bio: profile?.profile?.bio ?? "",
                    });
                }
            }, AwaitTime);
        }
    };

    const removeImage = async () => {
        await Promise.all([
            removeAvatar(),
            setProfile({
                avatar: false,
                displayName: profile?.profile?.displayName ?? "",
                bio: profile?.profile?.bio ?? "",
            }),
        ]);
    };

    const avatarSrc = useAvatar(currentUser);

    return (
        <DialogContent>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>All information is public.</DialogDescription>
            <div className="flex items-center justify-between space-x-4">
                <img
                    src={avatarSrc}
                    alt={`Avatar of ${currentUser}`}
                    className={`h-24 w-24 rounded-lg object-cover transition-opacity duration-200 ${isUploadingAvatar || isRemovingAvatar ? "opacity-50" : ""}`}
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
                        {profile?.profile?.avatar && (
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

            {isLoading && <div>Loading...</div>}
            {isSuccess && (
                <FormProfile
                    initialData={profile?.profile || undefined}
                    onSubmit={async (data) => {
                        const currentAvatar = !!profile?.profile?.avatar;
                        await setProfile({
                            bio: data.bio,
                            displayName: data.displayName,
                            avatar: currentAvatar,
                        });
                        onClose();
                        return data;
                    }}
                />
            )}
            {isError && (
                <div className="text-destructive">{error?.message}</div>
            )}
        </DialogContent>
    );
};
