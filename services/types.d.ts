/// <reference types="node" />
/// <reference types="vite/client" />

declare const __dirname: string;
declare const process: {
  env: {
    NODE_ENV: string;
    VITE_SECURE_LOCAL_DEV?: string;
    VITE_SECURE_PATH_TO_CERTS?: string;
  };
}; 