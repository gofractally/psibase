import { FormProfile } from "@/components/form-profile";

import { Trash, Upload } from "lucide-react";

import { createIdenticon } from "@/lib/createIdenticon";

import { DialogDescription } from "@/components/ui/dialog";

import { DialogTitle } from "@/components/ui/dialog";

import { useChainId } from "@/hooks/useChainId";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUploadAvatar } from "../hooks/useUploadAvatar";
import { useProfile } from "../hooks/useProfile";
import { useSetProfile } from "../hooks/useSetProfile";
import { Button } from "@/components/ui/button";
import { AwaitTime } from "@/globals";
import { DialogContent } from "@/components/ui/dialog";
import { siblingUrl } from "@psibase/common-lib";
import { Input } from "@/components/ui/input";

export const EditProfileDialogContent = () => {
    const { mutateAsync: setProfile, isPending: isSettingProfile } =
        useSetProfile();

    const { data: currentUser } = useCurrentUser();
    const {
        data: profile,
        isSuccess,
        isError,
        isLoading,
        error,
    } = useProfile(currentUser);
    const { mutateAsync: uploadAvatar } = useUploadAvatar();

    const { data: chainId } = useChainId();

    const [tickImage, setTickImage] = useState(0);

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

            const isAvatar = !!profile?.profile?.avatar;
            if (!isAvatar) {
                setProfile({
                    avatar: true,
                    displayName: profile?.profile?.displayName ?? "",
                    bio: profile?.profile?.bio ?? "",
                });
            }

            setTimeout(() => {
                setTickImage(tickImage + 1);
            }, AwaitTime);
        }
    };

    const removeImage = async () => {
        // TODO: remove image from sites

        await setProfile({
            avatar: false,
            displayName: profile?.profile?.displayName ?? "",
            bio: profile?.profile?.bio ?? "",
        });
    };

    return (
        <DialogContent>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>All information is public.</DialogDescription>
            <div className="flex items-center space-x-4">
                <div className="flex-1">
                    <label htmlFor="icon-upload" className="cursor-pointer">
                        <div className="flex h-10 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                            <Upload className="mr-2 h-5 w-5" />
                            Upload avatar
                        </div>
                    </label>
                    <Input
                        id="icon-upload"
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="hidden"
                    />
                </div>
                <img
                    key={tickImage}
                    src={
                        profile?.profile?.avatar
                            ? siblingUrl(
                                  null,
                                  currentUser,
                                  `/profile/avatar?v=${tickImage}`,
                                  false,
                              )
                            : createIdenticon(
                                  chainId ?? "a" + currentUser ?? "b",
                              )
                    }
                    alt="Icon preview"
                    className="h-10 w-10 rounded-lg object-cover"
                />
                {profile?.profile?.avatar && (
                    <Button
                        type="button"
                        disabled={isSettingProfile}
                        onClick={() => {
                            removeImage();
                        }}
                        variant="outline"
                        size="icon"
                    >
                        <Trash className="h-4 w-4" />
                    </Button>
                )}
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
