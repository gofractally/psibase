import { useMutation } from "@tanstack/react-query";

import { useCacheBust } from "@shared/hooks/use-cache-bust";
import { callPluginFunction, homepage } from "@shared/lib/plugins";
import { AVATAR_OPTIONS, prepareImage } from "@shared/lib/prepare-image";
import SharedQueryKey from "@shared/lib/query-keys";
import { zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

export const useUploadAvatar = () => {
    const { setBustedUser } = useCacheBust();
    return useMutation<void, Error, { file: File }, string | number>({
        mutationKey: ["uploadAvatar"],
        mutationFn: async ({ file }) => {
            const avatar = await prepareImage(file, AVATAR_OPTIONS);
            await callPluginFunction(homepage.contacts.uploadAvatar, [avatar]);
        },
        onMutate: () => toast.loading("Uploading avatar..."),
        onSuccess: (_data, _variables, toastId, context) => {
            toast.success("Avatar uploaded", { id: toastId });

            const currentUser = zAccount.parse(
                context.client.getQueryData(SharedQueryKey.currentUser()),
            );
            setBustedUser(currentUser);
        },
        onError: (error, _variables, toastId) => {
            toast.error(error.message || "Failed to upload avatar", {
                id: toastId,
            });
        },
    });
};
