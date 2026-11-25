use crate::policy::MAX_VALUE_LEN;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;

/// Standard base64 in JSON. Longer than `MAX_VALUE_LEN` is rejected.
#[cfg_attr(test, derive(Debug, PartialEq))]
pub(crate) struct Base64(pub(crate) Vec<u8>);

impl<'de> Deserialize<'de> for Base64 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;

        impl serde::de::Visitor<'_> for Visitor {
            type Value = Base64;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("standard base64")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Base64, E> {
                let bytes = STANDARD.decode(value).map_err(E::custom)?;
                if bytes.len() > MAX_VALUE_LEN {
                    return Err(E::custom("value exceeds maximum length"));
                }
                Ok(Base64(bytes))
            }
        }

        deserializer.deserialize_str(Visitor)
    }
}
