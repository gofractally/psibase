import { getEvaluation, Evaluation } from "@lib/getEvaluation";
import { useQuery } from "@tanstack/react-query";



export const useEvaluation = (id: number) => useQuery<Evaluation>({
    queryKey: ["evaluation", id],
    queryFn: async () => getEvaluation(id),
});
