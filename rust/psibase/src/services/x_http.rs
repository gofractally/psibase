#[crate::service(name = "x-http", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{HttpReply, HttpRequest, MethodNumber, SocketEndpoint, TLSInfo};

    /// Sends a message to a socket. HTTP sockets should use sendReply, instead.
    #[action]
    fn send(socket: i32, data: Vec<u8>) {
        unimplemented!()
    }

    /// Sends an HTTP request and returns the new socket. When the response
    /// is available, it will be passed to `sender::callback(socket, reply)`.
    /// If the the request fails without a response, calls `sender::err(socket)`
    #[action]
    fn sendRequest(
        request: HttpRequest,
        callback: MethodNumber,
        err: MethodNumber,
        tls: Option<TLSInfo>,
        endpoint: Option<SocketEndpoint>,
    ) -> i32 {
        unimplemented!()
    }

    /// Enables or disables automatic closing of the socket
    /// when the transaction context exits.
    ///
    /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
    #[action]
    fn autoClose(socket: i32, value: bool) {
        unimplemented!()
    }

    /// Sends an HTTP response. The socket must have autoClose enabled.
    #[action]
    fn sendReply(socket: i32, response: HttpReply) {
        unimplemented!()
    }

    /// Returns the root host for a given host
    #[action]
    fn rootHost(host: String) -> String {
        unimplemented!()
    }

    /// Called by the host at the beginning of a session
    #[action]
    fn startSession() {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
