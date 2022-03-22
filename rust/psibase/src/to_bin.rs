use custom_error::custom_error;
use serde::*;
use std::mem::swap;

struct Serializer {
    data: Vec<u8>,
}

/// [crate::from_bin] and [crate::to_bin] are incomplete. They'll disappear when switch to fracpack is complete.
pub fn to_bin<T: Serialize>(v: &T) -> Vec<u8> {
    v.serialize(Serializer { data: Vec::new() }).unwrap().data
}

fn varuint32_to_bin(mut val: u64, data: &mut Vec<u8>) {
    assert!((val >> 32) == 0);
    loop {
        let mut b = (val & 0x7f) as u8;
        val >>= 7;
        b |= ((val > 0) as u8) << 7;
        data.push(b);
        if val == 0 {
            break;
        }
    }
}

custom_error! { Error
    Dummy = "Not really used",
}

impl serde::ser::Error for Error {
    fn custom<T>(_msg: T) -> Self
    where
        T: std::fmt::Display,
    {
        todo!()
    }
}

impl serde::Serializer for Serializer {
    type Ok = Self;
    type Error = Error;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;

    fn serialize_bool(mut self, v: bool) -> Result<Self::Ok, Self::Error> {
        if v {
            self.data.push(1);
        } else {
            self.data.push(0);
        }
        Ok(self)
    }

    fn serialize_i8(mut self, v: i8) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_i16(mut self, v: i16) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_i32(mut self, v: i32) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_i64(mut self, v: i64) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_u8(mut self, v: u8) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_u16(mut self, v: u16) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_u32(mut self, v: u32) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_u64(mut self, v: u64) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_f32(mut self, v: f32) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_f64(mut self, v: f64) -> Result<Self::Ok, Self::Error> {
        self.data.extend_from_slice(&v.to_le_bytes());
        Ok(self)
    }

    fn serialize_char(self, _v: char) -> Result<Self::Ok, Self::Error> {
        todo!()
    }

    fn serialize_str(self, v: &str) -> Result<Self::Ok, Self::Error> {
        self.serialize_bytes(v.as_bytes())
    }

    fn serialize_bytes(mut self, v: &[u8]) -> Result<Self::Ok, Self::Error> {
        varuint32_to_bin(v.len() as u64, &mut self.data);
        self.data.extend_from_slice(v);
        Ok(self)
    }

    fn serialize_none(mut self) -> Result<Self::Ok, Self::Error> {
        self.data.push(0);
        Ok(self)
    }

    fn serialize_some<T: ?Sized>(mut self, _value: &T) -> Result<Self::Ok, Self::Error>
    where
        T: Serialize,
    {
        self.data.push(1);
        todo!()
    }

    fn serialize_unit(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Self::Ok, Self::Error> {
        todo!()
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
    ) -> Result<Self::Ok, Self::Error> {
        todo!()
    }

    fn serialize_newtype_struct<T: ?Sized>(
        self,
        _name: &'static str,
        _value: &T,
    ) -> Result<Self::Ok, Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn serialize_newtype_variant<T: ?Sized>(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _value: &T,
    ) -> Result<Self::Ok, Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn serialize_seq(mut self, len: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        varuint32_to_bin(len.unwrap() as u64, &mut self.data);
        Ok(self)
    }

    fn serialize_tuple(self, _len: usize) -> Result<Self::SerializeTuple, Self::Error> {
        todo!()
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeTupleStruct, Self::Error> {
        todo!()
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeTupleVariant, Self::Error> {
        todo!()
    }

    fn serialize_map(self, _len: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        todo!()
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeStruct, Self::Error> {
        Ok(self)
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeStructVariant, Self::Error> {
        todo!()
    }
}

impl ser::SerializeSeq for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_element<T: ?Sized>(&mut self, value: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        let mut other = Serializer { data: Vec::new() };
        swap(&mut self.data, &mut other.data);
        *self = value.serialize(other)?;
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self)
    }
}

impl ser::SerializeTuple for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_element<T: ?Sized>(&mut self, _value: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }
}

impl ser::SerializeTupleStruct for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_field<T: ?Sized>(&mut self, _value: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }
}

impl ser::SerializeTupleVariant for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_field<T: ?Sized>(&mut self, _value: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }
}

impl ser::SerializeMap for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_key<T: ?Sized>(&mut self, _key: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn serialize_value<T: ?Sized>(&mut self, _value: &T) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }
}

impl ser::SerializeStruct for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_field<T: ?Sized>(
        &mut self,
        _key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        let mut other = Serializer { data: Vec::new() };
        swap(&mut self.data, &mut other.data);
        *self = value.serialize(other)?;
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self)
    }
}

impl ser::SerializeStructVariant for Serializer {
    type Ok = Serializer;
    type Error = Error;

    fn serialize_field<T: ?Sized>(
        &mut self,
        _key: &'static str,
        _value: &T,
    ) -> Result<(), Self::Error>
    where
        T: Serialize,
    {
        todo!()
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        todo!()
    }
}
