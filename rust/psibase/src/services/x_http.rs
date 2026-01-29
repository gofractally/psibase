#[crate::service(name = "x-http", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{HttpReply, HttpRequest, MethodNumber, SocketEndpoint, TLSInfo};

    /// Sends a message to a socket. HTTP sockets should use sendReply, instead.
    #[action]
    fn send(socket: i32, data: Vec<u8>) {
        unimplemented!()
    }

    /// Sends an HTTP request and returns the new socket.
    ///
    /// Must be followed by `setCallback(socket, callback, err)`, or the
    /// socket will be closed when the current context exits. When the response
    /// is available, it will be passed to `sender::callback(socket, reply)`.
    /// If the the request fails without a response, calls `sender::err(socket)`
    #[action]
    fn sendRequest(
        request: HttpRequest,
        tls: Option<TLSInfo>,
        endpoint: Option<SocketEndpoint>,
    ) -> i32 {
        unimplemented!()
    }

    /// Opens a websocket connection and returns the new socket.
    ///
    /// Must be followed by `setCallback(socket, callback, err)`, or the
    /// socket will be closed when the current context exits. The
    /// request method must be GET. The required headers for the websocket
    /// handshake will be added to the request if they are not already
    /// provided. If the connection is successfully established, calls
    /// `sender::callback(socket, reply)`. If the request fails without
    /// a response, calls `sender::err(socket, nullopt)`. If the response
    /// does not complete a websocket handshake, calls
    /// `sender::err(socket, optional(reply))`
    #[action]
    fn websocket(
        request: HttpRequest,
        tls: Option<TLSInfo>,
        endpoint: Option<SocketEndpoint>,
    ) -> i32 {
        unimplemented!();
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

    /// Accepts a websocket connection. The response must be a
    /// valid websocket handshake for the request.
    ///
    /// Must be followed by `setCallback(socket, callback, err)`, or the
    /// socket will be closed when the current context exits.
    #[action]
    fn accept(socket: i32, reply: HttpReply) {
        unimplemented!()
    }

    /// Changes the callback for a socket. The sender must be the owner
    /// of the socket.
    #[action]
    fn setCallback(socket: i32, callback: MethodNumber, err: MethodNumber) {
        unimplemented!()
    }

    /// Close a socket. The socket should be either a websocket
    /// or a pending http request.
    #[action]
    fn close(socket: i32) {
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
