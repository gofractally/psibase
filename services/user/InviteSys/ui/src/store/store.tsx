import React, { useMemo, useReducer } from "react";

import { store } from "./hooks";
import * as StoreTypes from "./types";

const initialState: StoreTypes.State = {
    user: null,
};

const reducer = (
    state: StoreTypes.State,
    action: StoreTypes.Action
): StoreTypes.State => {
    const { type, payload } = action;
    switch (type) {
        case StoreTypes.ActionType.SetUser:
            return { ...state, user: payload };
        default:
            return state;
    }
};

const Provider = store.Provider;

export const StateProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, dispatch] = useReducer(reducer, initialState);

    // ensure unrelated <WebApp /> rerenders of provider do not cause consumers to rerender
    // https://hswolff.com/blog/how-to-usecontext-with-usereducer/#performance-concerns
    const contextValue = useMemo(() => {
        return { state, dispatch };
    }, [state, dispatch]);

    return <Provider value={contextValue}>{children}</Provider>;
};
