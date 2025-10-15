use crate::check;

pub trait FlagsType {
    type BitsetType: Copy
        + std::ops::BitOr<Output = Self::BitsetType>
        + std::ops::BitAnd<Output = Self::BitsetType>
        + std::ops::Not<Output = Self::BitsetType>
        + std::ops::Shl<u8, Output = Self::BitsetType>
        + PartialEq
        + From<u8>;

    type JsonType: serde::Serialize + serde::de::DeserializeOwned + async_graphql::OutputType;

    fn index(&self) -> u8;
}

/// # Flags
///
/// `Flags` represents a bitset structure that works with flag types implementing `FlagsType`.
///
/// Provides a convenient way to manage an integer that represents a set of boolean flags
/// using strongly-typed indices.
///
/// # Type Parameter
///
/// * `F` - The flag type that implements `FlagsType`
pub struct Flags<F: FlagsType> {
    value: F::BitsetType,
    _phantom: std::marker::PhantomData<F>,
}

impl<F: FlagsType> Flags<F> {
    pub fn new(value: F::BitsetType) -> Self {
        Self {
            value,
            _phantom: std::marker::PhantomData,
        }
    }

    fn validate_index(index: u8) {
        check(
            index < std::mem::size_of::<F::BitsetType>() as u8 * 8,
            format!("invalid index of {}", index).as_str(),
        );
    }

    pub fn set(&mut self, flag: F, value: bool) -> &mut Self {
        let index = flag.index();
        Self::validate_index(index);

        if value {
            self.value = self.value | (F::BitsetType::from(1) << index);
        } else {
            self.value = self.value & !(F::BitsetType::from(1) << index);
        }
        self
    }

    pub fn get(&self, flag: F) -> bool {
        let index = flag.index();
        Self::validate_index(index);
        (self.value & (F::BitsetType::from(1) << index)) != F::BitsetType::from(0)
    }

    pub fn value(&self) -> F::BitsetType {
        self.value
    }
}

/// Macro to generate a new struct that implements `FlagsType` so it can
/// be used with `Flags`.
///
/// ### Example
///
/// ```rust,ignore
/// define_flags!(SampleFlags, u8, {
///     first_flag,
///     second_flag,
///     third_flag,
/// });
/// ```
///
/// This allows for usage like:
///
/// ```rust,ignore
/// Flags::new(bitset).get(SampleFlags::FIRST_FLAG);
/// Flags::new(bitset).set(SampleFlags::SECOND_FLAG, true);
/// SampleFlagsJson::from(Flags::new(bitset));
/// ```
///
/// The SampleFlagsJson struct would look like:
///
/// ```rust,ignore
/// #[derive(serde::Serialize, serde::Deserialize, async_graphql::SimpleObject)]
/// #[serde(rename_all = "camelCase")]
/// pub struct SampleFlagsJson {
///     pub first_flag: bool,
///     pub second_flag: bool,
///     pub third_flag: bool,
/// }
/// ```
#[macro_export]
macro_rules! define_flags {
    ($name:ident, $storage:ty, { $($field:ident),* $(,)? }) => {
        $crate::define_flags!(@impl $name, $storage, 0, [], [$($field,)*]);
    };

    (@impl $name:ident, $storage:ty, $index:expr, [$($done_field:ident: $done_index:expr,)*], [$current:ident, $($rest:ident,)*]) => {
        $crate::define_flags!(@impl $name, $storage, $index + 1, [$($done_field: $done_index,)* $current: $index,], [$($rest,)*]);
    };

    (@impl $name:ident, $storage:ty, $index:expr, [$($field:ident: $field_index:expr,)*], []) => {
        $crate::paste::paste! {
            #[derive(Debug, Clone, Copy, PartialEq, Eq)]
            pub struct $name(u8);

            impl $name {
                $(
                    pub const [<$field:snake:upper>]: $name = $name($field_index);
                )*

                pub fn to_string(&self) -> &'static str {
                    $(
                        if self.0 == $field_index {
                            return stringify!($field);
                        }
                    )*
                    "unknown"
                }
            }

            impl From<u8> for $name {
                fn from(index: u8) -> Self {
                    $name(index)
                }
            }

            impl $crate::FlagsType for $name {
                type BitsetType = $storage;
                type JsonType = [<$name Json>];

                fn index(&self) -> u8 {
                    self.0
                }
            }

            #[derive(serde::Serialize, serde::Deserialize, async_graphql::SimpleObject)]
            #[serde(rename_all = "camelCase")]
            pub struct [<$name Json>] {
                $(
                    pub $field: bool,
                )*
            }

            impl [<$name Json>] {
                pub fn from_flags(flags: &$crate::Flags<$name>) -> Self {
                    Self {
                        $(
                            $field: flags.get($name::[<$field:snake:upper>]),
                        )*
                    }
                }

                pub fn to_flags(&self) -> $crate::Flags<$name> {
                    let mut flags = $crate::Flags::new(<$storage>::from(0));
                    $(
                        flags.set($name::[<$field:snake:upper>], self.$field);
                    )*
                    flags
                }
            }

            impl From<$crate::Flags<$name>> for [<$name Json>] {
                fn from(flags: $crate::Flags<$name>) -> Self {
                    Self::from_flags(&flags)
                }
            }

            impl From<[<$name Json>]> for $crate::Flags<$name> {
                fn from(json: [<$name Json>]) -> Self {
                    json.to_flags()
                }
            }
        }
    };
}
