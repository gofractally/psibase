import { Trash, Upload } from "lucide-react";

import { FormProfile } from "@/components/form-profile";

import { useAvatar } from "@/hooks/use-avatar";
import { useCacheBust } from "@/hooks/use-cache-bust";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfile } from "@/hooks/use-profile";

import { Button } from "@shared/shadcn/ui/button";
import { DialogDescription } from "@shared/shadcn/ui/dialog";
import { DialogTitle } from "@shared/shadcn/ui/dialog";
import { DialogContent } from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { toast } from "@shared/shadcn/ui/sonner";

import { useRemoveAvatar } from "../hooks/use-remove-avatar";
import { useSetProfile } from "../hooks/use-set-profile";
import { useUploadAvatar } from "../hooks/use-upload-avatar";

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

    const { avatarSrc, type } = useAvatar(currentUser);
    const removeImage = async () => {
        await removeAvatar();
    };

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

            {isLoading && <div>Loading...</div>}
            {isSuccess && (
                <FormProfile
                    initialData={profile?.profile || undefined}
                    onSubmit={async (data) => {
                        await setProfile({
                            bio: data.bio,
                            displayName: data.displayName,
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
