import { getSupervisor } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";

const supervisor = getSupervisor();

export const useDecodeB64 = (encodedString: string | null) =>
  useQuery<string>({
    queryKey: ["decodeB64", encodedString],
    enabled: !!encodedString,
    queryFn: async () => {
      const bytes = await supervisor.functionCall({
        service: "base64",
        intf: "url",
        method: "decode",
        params: [encodedString],
      });
      const decoder = new TextDecoder();
      return decoder.decode(bytes);
    },
  });
