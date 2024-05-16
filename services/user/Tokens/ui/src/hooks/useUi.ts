import { fetchUi } from "@/lib/graphql/ui";
import { useQuery } from "@tanstack/react-query";

export const useUi = (username: string) => {
  return useQuery({
    queryKey: ["ui", username],
    queryFn: () => fetchUi(username),
  });
};
