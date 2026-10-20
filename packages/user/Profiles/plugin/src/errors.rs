use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    ContactNotFound(account: String) => "Contact not found: {account}",
    InvalidAccountNumber(account: String) => "Invalid account name: {account}",
    NoUserLoggedIn() => "Not logged in",
    NoAccountFound(account: String) => "No account found: {account}",
    ContactAlreadyExists(account: String) => "Contact already exists: {account}",
    AvatarTooBig(size: String) => "Avatar exceeds max file size of {size}",
    InvalidAvatarContentType(content_type: String) =>
        "Avatar content type not allowed: {content_type}",
}
