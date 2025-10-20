import { useGetFractalGuildQuery } from "@/lib/graphql/generated";

import { useFractalAccount } from "./use-fractal-account";

export const useFractal = () => {
    const currentFractal = useFractalAccount();
    return useGetFractalGuildQuery({
        variables: { fractal: currentFractal },
        skip: !currentFractal,
    });
};
