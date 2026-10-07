use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized(msg: &'a str) => "Unauthorized access: {msg}",
    NotConnected(user: String) => "User {user} is not connected to this app",
}
