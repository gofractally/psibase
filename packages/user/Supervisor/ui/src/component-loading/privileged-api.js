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

    importKey(privateKey) {
        return host.importKey(privateKey);
    },

    signExplicit(msg, privateKey) {
        return host.signExplicit(preimage, privateKey);
    },

    sign(msg, publicKey) {
        return host.sign(preimage, publicKey);
    }
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
    requestPrompt() {
        return host.requestPrompt();
    },
};
