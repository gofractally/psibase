use psibase::fracpack::{Pack, Unpack};

/// Fracpack layout for the `importnew` prompt context.
/// Field order matches `host:login-prompt/api.import-context`.
#[derive(Pack, Unpack, Debug, PartialEq, Eq)]
pub struct ImportNewContext {
    pub account: String,
    pub key: String,
    pub login: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let context = ImportNewContext {
            account: "alice".into(),
            key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----".into(),
            login: true,
        };
        assert_eq!(
            ImportNewContext::unpacked(&context.packed()).unwrap(),
            context
        );
    }
}
