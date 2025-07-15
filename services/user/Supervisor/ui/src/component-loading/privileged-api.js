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
};
