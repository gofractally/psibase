use crate::{Pack, Result, Unpack, UnpackOwned};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::marker::PhantomData;

#[derive(Debug, PartialEq, Eq)]
pub struct Nested<T> {
    data: Vec<u8>,
    _phantom: PhantomData<T>,
}

impl<T> Nested<T> {
    pub fn new(data: Vec<u8>) -> Self {
        Self {
            data,
            _phantom: PhantomData,
        }
    }
}

impl<T: Pack> Pack for Nested<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn is_empty_container(&self) -> bool {
        self.data.is_empty()
    }

    fn pack(&self, dest: &mut Vec<u8>) {
        self.data.pack(dest)
    }
}

impl<'a, T: Unpack<'a>> Unpack<'a> for Nested<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;
    fn new_empty_container() -> Result<Self> {
        let data = b"";
        T::verify_no_extra(data)?;
        Ok(Self::new(data.to_vec()))
    }

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let data = <&[u8]>::unpack(src, pos)?;
        T::verify_no_extra(&data)?;
        Ok(Self::new(data.to_owned()))
    }
    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let data = <&[u8]>::unpack(src, pos)?;
        T::verify_no_extra(data)
    }
}

impl<T: Serialize + UnpackOwned> Serialize for Nested<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        T::unpacked(&self.data).unwrap().serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de> + Pack> Deserialize<'de> for Nested<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(Self::new(T::deserialize(deserializer)?.packed()))
    }
}
