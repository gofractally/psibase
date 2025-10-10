import { useParams } from "react-router-dom";

export const useGuildAccount = (): string | undefined => {
    const { guildAccount } = useParams();
    return guildAccount;
};
