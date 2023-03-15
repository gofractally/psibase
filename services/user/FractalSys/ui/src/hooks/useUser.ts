import { useEffect } from "react";

import { AppletId, initializeApplet, query } from "@psibase/common-lib";

import { UserData } from "pages/meeting/types";
import { useGlobalStore } from "store";
import { setUser } from "store/actions";

const noAvatarUrl =
    "https://images.hive.blog/p/X37EMQ9WSwsMkbaFFVtss2tEEKpVvbqx1wBjz6fCwXa41QNVwbz8YG8D7SsNDaVSpEJmfwUkNU9b82DE4zrWrusmgafrs2L25RaS7?width=128&height=128";

export const useUser = () => {
    const { state, dispatch } = useGlobalStore();
    const { user } = state;

    const logOut = () => {
        dispatch(setUser());
    };

    const fetchAndSetUser = async (): Promise<string> => {
        const accountSys = new AppletId("account-sys");
        const getLoggedInUser = () =>
            query<void, string>(accountSys, "getLoggedInUser");

        const user = (await getLoggedInUser()) as string;
        dispatch(setUser(user, user, noAvatarUrl));
        return user;
    };

    useEffect(() => {
        initializeApplet();
        fetchAndSetUser();
    }, []);

    const getUserInfo = (): UserData | undefined => {
        if (user) {
            return {
                participantId: user.id,
                name: user.name,
                photo: user.avatarUrl,
            };
        }
    };

    return {
        user: getUserInfo(),
        logOut,
    };
};

export default useUser;
