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

    getChainId() {
        return host.getChainId();
    },

    getActiveApp() {
        return host.getActiveApp();
    },

    getPlatformAccount() {
        return host.getPlatformAccount();
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

export const prompt = {
    requestPrompt(id) {
        return host.requestPrompt(id);
    },
};
