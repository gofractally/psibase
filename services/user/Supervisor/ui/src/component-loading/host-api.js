export const server = {
    addActionToTransaction(action, args) {
        return host.addActionToTransaction(action, args);
    },

    postGraphqlGetJson(graphQL) {
        return host.postGraphqlGetJson(graphQL);
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
};
