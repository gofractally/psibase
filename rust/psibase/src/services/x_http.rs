#[crate::service(name = "x-http", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::HttpReply;

    /// Sends a message to a socket. HTTP sockets should use sendReply, instead.
    #[action]
    fn send(socket: i32, data: Vec<u8>) {
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
