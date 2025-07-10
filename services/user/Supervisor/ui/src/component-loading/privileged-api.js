export const intf = {
    getActiveApp() {
        return host.getActiveApp();
    },

    syncSend(req) {
        return host.syncSend(req);
    },

    serviceStack() {
        return host.getServiceStack();
    },

    getRootDomain() {
        return host.getRootDomain();
    },
};
