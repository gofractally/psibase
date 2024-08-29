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
    loginTemp(appOrigin, user) {
        return host.loginTemp(appOrigin, user);
    },

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
