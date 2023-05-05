import { LogConfig } from "../log/interfaces";

export type ServiceConfig = {
    host: string;
    root: string;
    // auto-generated
    key: string;
};

export type ListenConfig = {
    protocol: string;
    address?: string;
    port?: number;
    path?: string;
    // auto-generated
    key: string;
    text?: string;
};

export type PsinodeConfig = {
    p2p: boolean;
    peers: string[];
    producer: string;
    host: string;
    port: number;
    listen: ListenConfig[];
    services: ServiceConfig[];
    admin: string;
    loggers: { [index: string]: LogConfig };
};
