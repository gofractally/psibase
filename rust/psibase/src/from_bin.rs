use custom_error::custom_error;
use serde::de;

custom_error! { pub Error
    ReadPastEnd = "Read past end",
    BadVaruint  = "Bad varuint",
    BadUTF8     = "Bad UTF8",
}

impl serde::de::Error for Error {
    fn custom<T>(_msg: T) -> Self
    where
        T: std::fmt::Display,
    {
        todo!()
    }
}

/// [crate::from_bin] and [crate::to_bin] are incomplete. They'll disappear when switch to fracpack is complete.
pub fn from_bin<'de, T: de::Deserialize<'de>>(mut data: &'de [u8]) -> Result<T, Error> {
    T::deserialize(Deserializer { data: &mut data })
}

fn read_u8_arr<const SIZE: usize>(data: &mut &[u8]) -> Result<[u8; SIZE], Error> {
    let mut bytes: [u8; SIZE] = [0; SIZE];
    bytes.copy_from_slice(data.get(0..SIZE).ok_or(Error::ReadPastEnd)?);
    *data = data.get(SIZE..).ok_or(Error::ReadPastEnd)?;
    Ok(bytes)
}

fn read_varuint32(data: &mut &[u8]) -> Result<u32, Error> {
    let mut result: u32 = 0;
    let mut shift = 0;
    loop {
        if shift >= 35 {
            return Err(Error::BadVaruint);
        }
        let b = read_u8_arr::<1>(data)?[0];
        result |= ((b & 0x7f) as u32) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            break;
        }
    }
    Ok(result)
}

struct Deserializer<'de, 'a> {
    data: &'a mut &'de [u8],
}

macro_rules! impl_de {
    ($t:ty, $des:ident, $visit:ident) => {
        fn $des<V>(self, visitor: V) -> Result<V::Value, Self::Error>
        where
            V: de::Visitor<'de>,
        {
            visitor.$visit(<$t>::from_le_bytes(read_u8_arr(self.data)?))
        }
    };
}

impl<'de, 'a> serde::Deserializer<'de> for Deserializer<'de, 'a> {
    type Error = Error;

    fn deserialize_any<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_bool<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        if read_u8_arr::<1>(self.data)?[0] != 0 {
            visitor.visit_bool(true)
        } else {
            visitor.visit_bool(false)
        }
    }

    impl_de! {i8, deserialize_i8, visit_i8}
    impl_de! {i16, deserialize_i16, visit_i16}
    impl_de! {i32, deserialize_i32, visit_i32}
    impl_de! {i64, deserialize_i64, visit_i64}
    impl_de! {u8, deserialize_u8, visit_u8}
    impl_de! {u16, deserialize_u16, visit_u16}
    impl_de! {u32, deserialize_u32, visit_u32}
    impl_de! {u64, deserialize_u64, visit_u64}
    impl_de! {f32, deserialize_f32, visit_f32}
    impl_de! {f64, deserialize_f64, visit_f64}

    fn deserialize_char<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_str<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        let len = read_varuint32(self.data)? as usize;
        let result = self.data.get(0..len).ok_or(Error::ReadPastEnd)?;
        *self.data = self.data.get(len..).ok_or(Error::ReadPastEnd)?;
        visitor.visit_str(std::str::from_utf8(result).or(Err(Error::BadUTF8))?)
    }

    fn deserialize_string<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        let len = read_varuint32(self.data)? as usize;
        let result = self.data.get(0..len).ok_or(Error::ReadPastEnd)?;
        *self.data = self.data.get(len..).ok_or(Error::ReadPastEnd)?;
        visitor.visit_string(String::from_utf8(result.into()).or(Err(Error::BadUTF8))?)
    }

    fn deserialize_bytes<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        let len = read_varuint32(self.data)? as usize;
        let result = self.data.get(0..len).ok_or(Error::ReadPastEnd)?;
        *self.data = self.data.get(len..).ok_or(Error::ReadPastEnd)?;
        visitor.visit_bytes(result)
    }

    fn deserialize_byte_buf<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        let len = read_varuint32(self.data)? as usize;
        let result = self.data.get(0..len).ok_or(Error::ReadPastEnd)?;
        *self.data = self.data.get(len..).ok_or(Error::ReadPastEnd)?;
        visitor.visit_byte_buf(result.into())
    }

    fn deserialize_option<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_unit<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_unit_struct<V>(
        self,
        _name: &'static str,
        _visitor: V,
    ) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_newtype_struct<V>(
        self,
        _name: &'static str,
        _visitor: V,
    ) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_seq<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        let len = read_varuint32(self.data)? as usize;
        self.deserialize_tuple(len, visitor)
    }

    fn deserialize_tuple<V>(self, len: usize, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        visitor.visit_seq(SeqAccess {
            deserializer: self,
            remaining: len,
        })
    }

    fn deserialize_tuple_struct<V>(
        self,
        _name: &'static str,
        _len: usize,
        _visitor: V,
    ) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_map<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_struct<V>(
        self,
        _name: &'static str,
        fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        self.deserialize_tuple(fields.len(), visitor)
    }

    fn deserialize_enum<V>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        _visitor: V,
    ) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_identifier<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }

    fn deserialize_ignored_any<V>(self, _visitor: V) -> Result<V::Value, Self::Error>
    where
        V: de::Visitor<'de>,
    {
        todo!()
    }
}

struct SeqAccess<'de, 'a> {
    deserializer: Deserializer<'de, 'a>,
    remaining: usize,
}

impl<'de, 'a> de::SeqAccess<'de> for SeqAccess<'de, 'a> {
    type Error = Error;

    fn next_element_seed<T>(&mut self, seed: T) -> Result<Option<T::Value>, Self::Error>
    where
        T: de::DeserializeSeed<'de>,
    {
        if self.remaining == 0 {
            Ok(None)
        } else {
            self.remaining -= 1;
            seed.deserialize(Deserializer {
                data: self.deserializer.data,
            })
            .map(Some)
        }
    }

    #[inline]
    fn size_hint(&self) -> Option<usize> {
        Some(self.remaining)
    }
}
