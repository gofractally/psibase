import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@shared/shadcn/ui/sonner";
import { z } from "zod";

const zAvatar = z.object({
    contentType: z.string(),
    content: z.any(),
});


const Params = z.object({
    avatar: zAvatar,
});

export const useUploadAvatar = () =>
    useMutation<void, Error, z.infer<typeof Params>>({
        mutationKey: ["uploadAvatar"],
        mutationFn: async (params) => {
            const { avatar } = Params.parse(params);

            void (await supervisor.functionCall({
                method: "uploadAvatar",
                params: [avatar],
                service: "profiles",
                intf: "api",
            }));
        },
        onSuccess: (_, __, toastId) => {
            toast.success("Avatar uploaded", { id: z.string().or(z.number()).parse(toastId) });
        },
        onMutate: () => toast.loading("Uploading avatar..."),
        onError: (error, _, toastId) => {
            const options = { id: z.string().or(z.number()).parse(toastId) };
            if (error instanceof Error) {
                toast.error(error.message, options);
            } else {
                toast.error("An unknown error occurred", options);
            }
        },
    });
