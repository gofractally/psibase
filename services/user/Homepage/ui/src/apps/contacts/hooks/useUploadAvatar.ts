import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const u8Schema = z.number().int().min(0).max(255);

const File = z.object({
    path: z.string(),
    contentType: z.string(),
    content: z.any(),
});

const Params = z.object({
    file: File,
    compressionQuality: u8Schema,
});

export const useUploadAvatar = () =>
    useMutation<void, Error, z.infer<typeof Params>>({
        mutationKey: ["uploadAvatar"],
        mutationFn: async (params) => {
            const { compressionQuality, file } = Params.parse(params);

            const res = await supervisor.functionCall({
                method: "uploadAvatar",
                params: [file, compressionQuality],
                service: "profiles",
                intf: "api",
            });

            console.log(res, "was the res");
        },
    });
