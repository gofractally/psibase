export type LogFilterInputs = {
    filter: string;
};

export type LogConfig = {
    type: string;
    filter: string;
    format: string;
    filename?: string;
    target?: string;
    rotationSize?: string;
    rotationTime?: string;
    maxSize?: string;
    maxFiles?: string;
    path?: string;
    flush?: boolean;
    command?: string;
};

export type NewLogInputs = {
    type: string;
    filter: string;
    format: string;
};

export type LogRecord = {
    TimeStamp: string;
    Severity: string;
    Message: string;
    RemoteEndpoint?: string;
    BlockId?: string;
    Request?: { Method: string; Target: string; Host: string };
    Response?: { Status: number; Bytes?: number; Time?: number };
};
