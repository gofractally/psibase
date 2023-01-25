export interface ContextType {
    state: State;
    dispatch: React.Dispatch<Action>;
}

export interface DefaultModalState {
    isOpen: boolean;
    resolver: ((success: boolean) => void) | null;
}

export type State = {
    user: {
        id: string;
        name: string;
        avatarUrl: string | null;
    } | null;
};

export type Action = { type: ActionType; payload: any };

export enum ActionType {
    SetUser = "SET_USER",
}

export type DefaultModalResolver = (value: boolean) => void;
export interface DefaultModalToggleArgs {
    display: boolean;
    resolver: DefaultModalResolver | null;
}
