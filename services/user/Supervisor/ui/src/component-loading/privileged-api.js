export const intf = {
    sendRequest(req) {
        return host.sendRequest(req);
    },

    serviceStack() {
        return host.getServiceStack();
    },

    getRootDomain() {
        return host.getRootDomain();
    },

    getActiveApp() {
        return host.getActiveApp();
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
