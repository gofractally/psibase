import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

export const useDecodeB64 = (encodedString: string | null) =>
    useQuery<string>({
        queryKey: ["decodeB64", encodedString],
        enabled: !!encodedString,
        queryFn: async () => {
            const bytes = z.instanceof(Uint8Array).parse(
                await supervisor.functionCall({
                    service: "base64",
                    intf: "url",
                    method: "decode",
                    params: [encodedString],
                }),
            );
            const decoder = new TextDecoder();
            return decoder.decode(bytes);
        },
    });
