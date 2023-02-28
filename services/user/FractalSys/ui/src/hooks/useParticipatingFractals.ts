import { useQuery } from "@tanstack/react-query";
import { fractals } from "dataDump";
import { mockDelay } from "./mockDelay";

interface FractalListItem {
    id: string;
    name: string;
    image: string;
}

export const useFractal = (fractalId?: string) => {
    return useQuery(
        ['fractal', fractalId],
        mockDelay(fractals.find(x => x.id === fractalId)!),
        { enabled: !!fractalId }
    )
}


export const useParticipatingFractals = (username?: string) => {

    return useQuery(
        ['fractals', username], 
        mockDelay<FractalListItem[]>(fractals),
        {
            enabled: !!username,
        }
    )
}