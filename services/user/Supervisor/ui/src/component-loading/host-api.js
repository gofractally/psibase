class PluginRef {
    constructor(service, plugin, intf) {
        this.service = service;
        this.plugin = plugin;
        this.intf = intf;
    }
}

export const types = { PluginRef };

export const server = {
    postGraphqlGetJson(graphQL) {
        return host.postGraphqlGetJson(graphQL);
    },

    post(request) {
        return host.post(request);
    },

    getJson(endpoint) {
        return host.getJson(endpoint);
    },
};

export const client = {
    getSenderApp() {
        return host.getSenderApp();
    },

    myServiceAccount() {
        return host.myServiceAccount();
    },

    myServiceOrigin() {
        return host.myServiceOrigin();
    },

    getAppUrl(app) {
        return host.getAppUrl(app);
    },

    promptUser(subpath, payloadJsonStr) {
        return host.promptUser(subpath, payloadJsonStr);
    },
};
