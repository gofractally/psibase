pub mod tokens {
    use crate::bindings::accounts::plugin::types::OriginationData;
    use base64::{engine::general_purpose::URL_SAFE, Engine};
    use psibase::fracpack::{Pack, Unpack};

    #[derive(Pack, Unpack, Clone)]
    pub struct ConnectionToken {
        pub app: Option<String>,
        pub origin: String,
    }

    impl ConnectionToken {
        pub fn new(sender: OriginationData) -> Self {
            Self {
                app: sender.app.clone(),
                origin: sender.origin.to_string(),
            }
        }

        pub fn from_str(token: &str) -> Option<Self> {
            if let Ok(token) = URL_SAFE.decode(token) {
                if let Ok(token) = <ConnectionToken>::unpacked(&token) {
                    return Some(token);
                }
            }

            None
        }
    }
}
