export const server = {
    postGraphqlGetJson(graphQL) {
        return host.postGraphqlGetJson(graphQL);
    },

    postBytes(request) {
        return host.postBytes(request);
    },

    getJson(endpoint) {
        return host.getJson(endpoint);
    },
};

export const client = {
    getSenderApp() {
        return host.getSenderApp();
    },

    getLoggedInUser() {
        return host.getLoggedInUser();
    },

    isLoggedIn() {
        return host.isLoggedIn();
    },

    myServiceAccount() {
        return host.myServiceAccount();
    },

    myServiceOrigin() {
        return host.myServiceOrigin();
    },
};
