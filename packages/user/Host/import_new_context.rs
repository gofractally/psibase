use psibase::fracpack::{Pack, Unpack};

/// Layout for the `importnew` prompt context.
/// Field order matches `host:login-prompt/types.import-context`.
#[derive(Pack, Unpack)]
pub struct ImportNewContext {
    pub account: String,
    pub key: String,
    pub login: bool,
}
