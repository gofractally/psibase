import { ActionType } from "./types";

export const setUser = (
    id?: string,
    name?: string,
    avatarUrl: string | null = null
) => {
    const payload = id ? { id, name, avatarUrl } : null;
    return {
        type: ActionType.SetUser,
        payload,
    };
};
