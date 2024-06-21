macro_rules! serialize_as_str {
    ($ty:ty, $desc:literal) => {
        impl serde::Serialize for $ty {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.to_string())
            }
        }

        impl<'de> serde::Deserialize<'de> for $ty {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                struct Visitor();
                impl<'de> serde::de::Visitor<'de> for Visitor {
                    type Value = $ty;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                        formatter.write_str(concat!("string containing ", $desc))
                    }

                    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                        <$ty>::from_str(v)
                            .map_err(|_| E::custom(concat!("Expected string containing ", $desc)))
                    }
                }

                deserializer.deserialize_str(Visitor())
            }
        }

        async_graphql::scalar!($ty);
    };
}

pub(crate) use serialize_as_str;
