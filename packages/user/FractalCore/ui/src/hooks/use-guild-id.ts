import { useParams } from "react-router-dom";

export const useGuildId = (): number | undefined => {
    const { guildId } = useParams();
    return guildId ? Number(guildId) : undefined;
};
