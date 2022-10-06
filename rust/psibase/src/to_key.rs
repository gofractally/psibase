use std::collections::{BTreeSet, BinaryHeap, LinkedList, VecDeque};

/// ToKey defines a conversion from a type to a sequence of bytes
/// whose lexicographical ordering is the same as the ordering of
/// the original type.
///
/// For any two objects of the same type T, a and b:
/// - a.to_key() < b.to_key() iff a < b
/// - a.to_key() is not a prefix of b.to_key()
///
/// This format doesn't have the guarantees that fracpack has.
/// e.g. adding new fields at the end of a struct or tuple which
/// is embedded in another struct or tuple doesn't work correctly
/// in ToKey's format. Most changes lead to data corruption.
///
/// The encoding rules match psibase's `to_key.hpp` implementation.
/// If there's any ordering differences between Rust and C++, the
/// C++ rules win. So far I haven't encountered any; e.g. Rust's
/// `Option` ordering matches C++'s `optional` ordering.
pub trait ToKey: Sized {
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

impl<T: ToKey> ToKey for &T {
    fn append_key(&self, key: &mut Vec<u8>) {
        T::append_key(self, key)
    }
}

impl<T: ToKey> ToKey for &mut T {
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
                    None => key.push(0),
                    Some(value) => {
                        let byte = value.to_be_bytes();
                        key.push(byte[0]);
                        if byte[0] == 0 {
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

macro_rules! seq_impl {
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
seq_impl! {Vec}
seq_impl! {VecDeque}
seq_impl! {LinkedList}
seq_impl! {BTreeSet}
seq_impl! {BinaryHeap}

impl<T: ToKey, const N: usize> ToKey for [T; N] {
    fn append_key(&self, key: &mut Vec<u8>) {
        for item in self {
            item.append_key(key);
        }
    }
}
