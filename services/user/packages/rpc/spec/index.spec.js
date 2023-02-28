import * as rpc from "../src/index";

describe("rpc-api", () => {
    it("sets baseUrl", () => {
        return rpc.setBaseUrl("https://www.google.com");
    });
});
