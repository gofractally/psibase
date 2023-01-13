import { LogConfig } from "../log/interfaces";

export type ServiceConfig = {
    host: string;
    root: string;
    // auto-generated
    key: string;
};

export type PsinodeConfig = {
    p2p: boolean;
    peers: string[];
    producer: string;
    host: string;
    port: number;
    services: ServiceConfig[];
    admin: string;
    loggers: { [index: string]: LogConfig };
};
