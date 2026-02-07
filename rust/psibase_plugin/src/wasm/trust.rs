use crate::host;
use crate::permissions;
use crate::types::Error;

pub use crate::permissions::types::TrustLevel;

pub struct Capabilities {
    pub low: &'static [&'static str],
    pub medium: &'static [&'static str],
    pub high: &'static [&'static str],
}

impl Capabilities {
    fn format(items: &[&str]) -> String {
        items
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn to_descriptions(&self) -> (String, String, String) {
        (
            Self::format(self.low),
            Self::format(self.medium),
            Self::format(self.high),
        )
    }
}

pub trait TrustConfig {
    fn capabilities() -> Capabilities;

    fn assert_authorized(level: TrustLevel, fn_name: &str) -> Result<(), Error> {
        Self::assert_authorized_with_whitelist(level, fn_name, vec![])
    }

    fn assert_authorized_with_whitelist(
        level: TrustLevel,
        fn_name: &str,
        whitelist: Vec<String>,
    ) -> Result<(), Error> {
        let authorized = permissions::api::is_authorized(
            &host::client::get_sender(),
            level,
            &Self::capabilities().to_descriptions(),
            fn_name,
            &whitelist,
        )?;
        if !authorized {
            panic!("Unauthorized call to: {fn_name}");
        }
        Ok(())
    }
}
