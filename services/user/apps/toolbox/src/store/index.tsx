import React, { createContext, useContext, useMemo, useReducer } from "react";

import { AlertBannerType } from "components/alert-banners";

import { ActionType } from "./actions";

interface ContextType {
    state: State;
    dispatch: React.Dispatch<Action>;
}

interface DefaultModalState {
    isOpen: boolean;
    resolver: ((success: boolean) => void) | null;
}

type State = {
    alertBanner: AlertBannerType;
    accountMenu: DefaultModalState;
    modalExample: DefaultModalState;
    modalCreateAddress: DefaultModalState;
};

type Action = { type: ActionType; payload: any };

const defaultModalState: DefaultModalState = {
    isOpen: false,
    resolver: null,
};

const initialState: State = {
    alertBanner: "set-up-profile",
    accountMenu: defaultModalState,
    modalExample: defaultModalState,
    modalCreateAddress: defaultModalState,
};
const store = createContext<ContextType | null>(null);
const { Provider } = store;

const reducer = (state: State, action: Action): State => {
    const { type, payload } = action;
    switch (type) {
        case ActionType.SetAlertBanner:
            return { ...state, alertBanner: payload.alertBanner };
        case ActionType.ToggleAccountMenu:
            return { ...state, accountMenu: payload };
        case ActionType.ToggleModalExample:
            return { ...state, modalExample: payload };
        case ActionType.ToggleModalCreateAddress:
            return { ...state, modalCreateAddress: payload };
        default:
            return state;
    }
};

const StateProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, dispatch] = useReducer(reducer, initialState);

    // ensure unrelated <WebApp /> rerenders of provider do not cause consumers to rerender
    // https://hswolff.com/blog/how-to-usecontext-with-usereducer/#performance-concerns
    const contextValue = useMemo(() => {
        return { state, dispatch };
    }, [state, dispatch]);

    return <Provider value={contextValue}>{children}</Provider>;
};

export const Store = { store, StateProvider };

export const useGlobalStore = () => {
    const globalStore = useContext(Store.store);
    if (!globalStore) throw new Error("hook should be within store provider");
    return globalStore;
};
