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
            <div className="flex items-center justify-between space-x-4">
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
                    className="h-24 w-24 rounded-lg object-cover"
                />
                <div className="flex flex-1 flex-col justify-center gap-2">
                    <div>
                        <Button variant="outline" asChild>
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
                                disabled={isSettingProfile}
                                onClick={() => {
                                    removeImage();
                                }}
                                variant="outline"
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
