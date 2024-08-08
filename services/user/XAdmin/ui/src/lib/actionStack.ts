interface Action {
    sender: string;
    service: string;
    method: string;
    rawData: string;
}

interface InnerTrace {
    ActionTrace?: ActionTrace;
    ConsoleTrace?: any;
    EventTrace?: any;
}

interface ActionTrace {
    action: Action;
    rawRetval: string;
    innerTraces: { inner: InnerTrace }[];
    totalTime: number;
    error?: string;
}

interface TransactionTrace {
    actionTraces: ActionTrace[];
    error?: string;
}

const getActionStack = (trace: ActionTrace): Action[] | undefined => {
    if (trace.error) {
        for (let atrace of trace.innerTraces) {
            if (atrace.inner.ActionTrace) {
                let result = getActionStack(atrace.inner.ActionTrace);
                if (result) {
                    return [trace.action, ...result];
                }
            }
        }
        return [trace.action];
    }
};
