use crate::check;

pub trait HasFlags<T> {
    fn set_flag(&mut self, index: u8, value: bool);
    fn get_flag(&self, index: u8) -> bool;
}

/// # Flags
///
/// `Flags` represents a bitset structure with a boolean value for each bit.
///
/// Provides a convenient way to manage an integer that represents a set of boolean flags.
///
/// It can work with any unsigned integer type (`u8`, `u16`, `u32`, `u64`, etc.). For example, Flags<u8>
/// can work with 8 flags, Flags<u16> can work with 16 flags, etc.
///
/// # Type Parameter
///
/// * `T` - The unsigned integer type to use for storing flags. Must implement
///   the required bitwise operation traits.
pub struct Flags<T> {
    value: T,
}

impl<T> Flags<T>
where
    T: Copy
        + std::ops::BitOr<Output = T>
        + std::ops::BitAnd<Output = T>
        + std::ops::Not<Output = T>
        + std::ops::Shl<u8, Output = T>
        + PartialEq
        + From<u8>,
{
    pub fn new(value: T) -> Self {
        Self { value }
    }

    fn validate_index(index: u8) {
        check(index < std::mem::size_of::<T>() as u8 * 8, "invalid index");
    }

    pub fn set(&mut self, index: u8, value: bool) -> &mut Self {
        Self::validate_index(index);
        if value {
            self.value = self.value | (T::from(1) << index);
        } else {
            self.value = self.value & !(T::from(1) << index);
        }
        self
    }

    pub fn get(&self, index: u8) -> bool {
        Self::validate_index(index);
        (self.value & (T::from(1) << index)) != T::from(0)
    }

    pub fn value(&self) -> T {
        self.value
    }
}

/// Macro to generate flag types with constants, get() method, and GraphQL schema
///
/// > **WARNING:** This macro does not check if the number of flags exceeds the storage
/// >              type capacity.
///
/// ### Usage example
/// ```rust,ignore
/// define_flags!(StructName, u8, {
///     first_flag,
///     second_flag,
///     third_flag,
/// });
/// ```
///
/// This generates:
///
/// - A struct with the given name and bool fields (snake_case names)
/// - Constants for each flag index (SCREAMING_SNAKE_CASE names) starting from 0
/// - A get() method that constructs the struct from a container's flags
/// - The generated struct has derives for serde::{Serialize, Deserialize}
///   and async_graphql::SimpleObject
///
/// #### Example generated code:
///
/// ```rust,ignore
/// #[derive(serde::Serialize, serde::Deserialize, async_graphql::SimpleObject)]
/// pub struct StructName {
///     pub first_flag:  bool,
///     pub second_flag: bool,
///     pub third_flag:  bool,
/// }
///
/// impl StructName {
///     pub const FIRST_FLAG:  u8 = 0;
///     pub const SECOND_FLAG: u8 = 1;
///     pub const THIRD_FLAG:  u8 = 2;
///
///     pub fn get(container: &impl crate::flags::HasFlags<u8>) -> Self {
///         Self {
///             first_flag:  container.get_flag(StructName::FIRST_FLAG),
///             second_flag: container.get_flag(StructName::SECOND_FLAG),
///             third_flag:  container.get_flag(StructName::THIRD_FLAG),
///         }
///     }
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
            #[derive(serde::Serialize, serde::Deserialize, async_graphql::SimpleObject)]
            pub struct $name {
                $(
                    pub $field: bool,
                )*
            }

            impl $name {
                $(
                    pub const [<$field:snake:upper>]: u8 = $field_index;
                )*

                pub fn get(container: &impl $crate::HasFlags<$storage>) -> Self {
                    Self {
                        $(
                            $field: container.get_flag($name::[<$field:snake:upper>]),
                        )*
                    }
                }
            }
        }
    };
}
