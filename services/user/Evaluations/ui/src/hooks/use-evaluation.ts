import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";





export const useEvaluation = (id: number) => useQuery({
    queryKey: ["evaluation", id],
    queryFn: async () => {
        const queriedExampleThing = await fetch(
            siblingUrl(undefined, "evaluations", "/graphql"),
            {
                method: "POST",
                body: JSON.stringify({
                    query: `{ getEvaluation(id: ${id}) { id } }`,
                }),
            },
        );
        return await queriedExampleThing.json();
    },
});

