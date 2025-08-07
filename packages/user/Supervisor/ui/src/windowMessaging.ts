export interface CallHandler {
    checkType: (param: any) => boolean;
    dispatch: (param: MessageEvent<any>) => void;
}

export const addCallHandler = (
    handlers: CallHandler[],
    checkType: (param: any) => boolean,
    dispatch: (param: MessageEvent<any>) => void,
) => {
    handlers.push({ checkType, dispatch });
};

export const registerCallHandlers = (
    handlers: CallHandler[],
    isValidMessage: (message: MessageEvent<any>) => boolean = (_) => true,
) => {
    window.addEventListener("message", (message: MessageEvent<any>) => {
        if (!isValidMessage(message)) {
            return;
        }

        const index: number = handlers.findIndex(({ checkType }) =>
            checkType(message.data),
        );
        if (index !== -1) {
            handlers[index].dispatch(message);
        }
    });
};
