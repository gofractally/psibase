import { useParams } from "react-router-dom";

export const useGuildSlug = (): number | undefined => {
    const { guildSlug } = useParams();
    return guildSlug ? Number(guildSlug) : undefined;
};
