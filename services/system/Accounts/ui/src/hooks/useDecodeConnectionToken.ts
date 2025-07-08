import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const DecodedConnectionToken = z.object({
    app: z.string(),
    origin: z.string().url(),
});

export const useDecodeConnectionToken = (
    token: string | undefined | null,
    enabled: boolean,
) =>
    useQuery({
        queryKey: ["login", token],
        enabled,
        queryFn: async () => {
            await supervisor.onLoaded();

            return DecodedConnectionToken.parse(
                await supervisor.functionCall({
                    service: "accounts",
                    intf: "admin",
                    method: "decodeConnectionToken",
                    params: [token],
                }),
            );
        },
    });
