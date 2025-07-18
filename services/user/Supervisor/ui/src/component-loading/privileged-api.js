export const intf = {
    getActiveApp() {
        return host.getActiveApp();
    },

    sendRequest(req) {
        return host.sendRequest(req);
    },

    serviceStack() {
        return host.getServiceStack();
    },

    getRootDomain() {
        return host.getRootDomain();
    },

    getChainId() {
        return host.getChainId();
    },
};

export const database = {
    get(...args) {
        return host.dbGet(...args);
    },
    set(...args) {
        return host.dbSet(...args);
    },
    remove(...args) {
        return host.dbRemove(...args);
    },
};
