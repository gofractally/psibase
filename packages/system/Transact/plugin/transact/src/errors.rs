use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    InvalidActionName(msg: &'a str) => "Invalid action name: {msg}",
    NotLoggedIn(msg: &'a str) => "Requires a logged-in user: {msg}",
}
