import { useParams } from "react-router-dom";

export const useGuildSlug = (): string | undefined => {
    const { guildSlug } = useParams();
    return guildSlug;
};
