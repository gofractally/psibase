use std::collections::{BTreeSet, LinkedList, VecDeque};

/// ToKey defines a conversion from a type to a sequence of bytes
/// whose lexicographical ordering is the same as the ordering of
/// the original type.
///
/// For any two objects of the same type T, a and b:
/// - a.to_key() < b.to_key() iff a < b
/// - a.to_key() is not a prefix of b.to_key()
///
/// This format doesn't have the guarantees that fracpack has.
/// e.g. adding new fields at the end of a struct or tuple can
/// corrupt data in some cases.
///
/// The encoding rules match psibase's `to_key.hpp` implementation.
/// If there are any ordering differences between Rust and C++, the
/// C++ rules win. So far I haven't encountered any; e.g. Rust's
/// `Option` ordering matches C++'s `optional` ordering.
///
/// # Caution
///
/// In Rust, it's easy to accidentally convert from a fixed-size
/// array reference (`&[T;7]`) to a slice (`&[T]`). This matters
/// to ToKey, which has different, and incompatible, encodings
/// for the two types.
pub trait ToKey {
    /// Convert to key
    fn to_key(&self) -> Vec<u8> {
        let mut key = Vec::new();
        self.append_key(&mut key);
        key
    }

    /// Append to key
    fn append_key(&self, key: &mut Vec<u8>);

    /// Append to key
    fn append_option_key(obj: &Option<&Self>, key: &mut Vec<u8>) {
        if let Some(x) = obj {
            key.push(1);
            x.append_key(key);
        } else {
            key.push(0);
        }
    }
}

/// A serialized key
///
/// The serialized data has the same sort order as the non-serialized form
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawKey {
    pub data: Vec<u8>,
}

impl RawKey {
    pub fn new(data: Vec<u8>) -> Self {
        RawKey { data }
    }
}

impl ToKey for RawKey {
    fn append_key(&self, key: &mut Vec<u8>) {
        key.extend_from_slice(&self.data[..]);
    }
}

impl<T: ToKey + ?Sized> ToKey for &T {
    fn append_key(&self, key: &mut Vec<u8>) {
        T::append_key(self, key)
    }
}

impl<T: ToKey + ?Sized> ToKey for &mut T {
    fn append_key(&self, key: &mut Vec<u8>) {
        T::append_key(self, key)
    }
}

impl ToKey for bool {
    fn append_key(&self, key: &mut Vec<u8>) {
        key.push(match self {
            false => 0,
            true => 1,
        });
    }

    fn append_option_key(obj: &Option<&Self>, key: &mut Vec<u8>) {
        key.push(match obj {
            None => 0,
            Some(false) => 1,
            Some(true) => 2,
        });
    }
}

macro_rules! byte_impl {
    ($t:ty) => {
        impl ToKey for $t {
            fn append_key(&self, key: &mut Vec<u8>) {
                key.extend_from_slice(&self.to_be_bytes());
            }

            fn append_option_key(obj: &Option<&Self>, key: &mut Vec<u8>) {
                match obj {
                    None => {
                        key.push(0);
                        key.push(0)
                    }
                    Some(value) => {
                        key.push(**value as u8);
                        if **value == 0 {
                            key.push(1);
                        }
                    }
                }
            }
        }
    };
}
byte_impl! {u8}
byte_impl! {i8}

macro_rules! scalar_impl {
    ($t:ty) => {
        impl ToKey for $t {
            fn append_key(&self, key: &mut Vec<u8>) {
                key.extend_from_slice(&self.wrapping_sub(<$t>::MIN).to_be_bytes());
            }
        }
    };
}
scalar_impl! {u16}
scalar_impl! {u32}
scalar_impl! {u64}
scalar_impl! {i16}
scalar_impl! {i32}
scalar_impl! {i64}

macro_rules! float_impl {
    ($t:ty, $t2:ty) => {
        impl ToKey for $t {
            fn append_key(&self, key: &mut Vec<u8>) {
                let mut result = self.to_bits();
                let signbit = 1 << (<$t2>::BITS - 1);
                let mut mask = 0;
                if result == signbit {
                    result = 0;
                }
                if (result & signbit) != 0 {
                    mask = !mask;
                }
                result ^= mask | signbit;
                result.append_key(key)
            }
        }
    };
}
float_impl! {f32,u32}
float_impl! {f64,u64}

impl<T: ToKey> ToKey for Option<T> {
    fn append_key(&self, key: &mut Vec<u8>) {
        T::append_option_key(&self.into(), key)
    }
}

macro_rules! str_impl {
    ($t:ty) => {
        impl ToKey for $t {
            fn append_key(&self, key: &mut Vec<u8>) {
                for byte in self.bytes() {
                    key.push(byte);
                    if byte == 0 {
                        key.push(1);
                    }
                }
                key.push(0);
                key.push(0)
            }
        }
    };
}
str_impl! {String}
str_impl! {&str}

macro_rules! container_impl {
    ($t:ident) => {
        impl<T: ToKey> ToKey for $t<T> {
            fn append_key(&self, key: &mut Vec<u8>) {
                for item in self.iter() {
                    T::append_option_key(&Some(item), key);
                }
                T::append_option_key(&None, key);
            }
        }
    };
}
container_impl! {Vec}
container_impl! {VecDeque}
container_impl! {LinkedList}
container_impl! {BTreeSet}

impl<T: ToKey> ToKey for [T] {
    fn append_key(&self, key: &mut Vec<u8>) {
        for item in self.iter() {
            T::append_option_key(&Some(item), key);
        }
        T::append_option_key(&None, key);
    }
}

impl<T: ToKey, const N: usize> ToKey for [T; N] {
    fn append_key(&self, key: &mut Vec<u8>) {
        for item in self {
            item.append_key(key);
        }
    }
}

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident)*))+) => {
        $(
            impl<$($name: ToKey),*> ToKey for ($($name,)*) {
                #[allow(non_snake_case)]
                fn append_key(&self, _key: &mut Vec<u8>) {
                    $(
                        self.$n.append_key(_key);
                    )*
                }
            }
        )+
    }
}

tuple_impls! {
    0 => ()
    1 => (0 T0)
    2 => (0 T0 1 T1)
    3 => (0 T0 1 T1 2 T2)
    4 => (0 T0 1 T1 2 T2 3 T3)
    5 => (0 T0 1 T1 2 T2 3 T3 4 T4)
    6 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5)
    7 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6)
    8 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7)
    9 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8)
    10 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9)
    11 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10)
    12 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11)
    13 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12)
    14 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13)
    15 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13 14 T14)
    16 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13 14 T14 15 T15)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_can_be_compared() {
        let a = RawKey::new(vec![1, 2, 3]);
        let b = RawKey::new(vec![1, 2, 3]);
        assert!(a == b, "keys expected to be equal");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3]);
        assert!(a > b, "key a expected to be greater than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 0]);
        assert!(a > b, "key a expected to be greater than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 3]);
        assert!(a > b, "key a expected to be greater than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 3, 0]);
        assert!(a > b, "key a expected to be greater than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 3, 255]);
        assert!(a > b, "key a expected to be greater than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 4, 0]);
        assert!(a < b, "key a expected to be less than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 4, 1]);
        assert!(a < b, "key a expected to be less than key b");

        let a = RawKey::new(vec![1, 2, 3, 4]);
        let b = RawKey::new(vec![1, 2, 3, 4, 255]);
        assert!(a < b, "key a expected to be less than key b");
    }
}
