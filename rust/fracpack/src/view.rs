use crate::{FracInputStream, Result, Unpack};
use std::marker::PhantomData;
use std::ops::{Deref, Index};

// The end is always the end of the outermost object.
#[repr(transparent)]
pub struct View<T> {
    _phantom: PhantomData<T>,
    data: [u8],
}

impl<'a, T: Unpack<'a>> View<T> {
    pub fn new<'b>(data: &'b [u8]) -> Result<&'b View<T>> {
        T::verify_no_extra(data)?;
        Ok(<View<T>>::new_unchecked(data))
    }
    fn new_unchecked<'b>(data: &'b [u8]) -> &'b View<T> {
        unsafe { &*(data as *const [u8] as *const View<T>) }
    }
    pub fn unpack(&'a self) -> T {
        T::unpacked(&self.data).unwrap()
    }
}

impl<'a, T: Unpack<'a>> View<Option<T>> {
    pub fn get(&self) -> Option<&View<T>> {
        let mut stream = FracInputStream::new(&self.data);
        let offset = u32::unpack(&mut stream).unwrap();
        if offset == 1 {
            None
        } else if offset == 0 {
            Some(<View<T>>::new_unchecked(&self.data))
        } else {
            Some(<View<T>>::new_unchecked(&self.data[offset as usize..]))
        }
    }
}

impl<'a, T: Unpack<'a>> Index<usize> for View<Vec<T>> {
    type Output = View<T>;
    fn index(&self, index: usize) -> &View<T> {
        let stream = FracInputStream::new(&self.data);
        let orig_pos = 4 + T::FIXED_SIZE * index as u32;
        if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
            let mut fixed_pos = orig_pos;
            let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
            if offset > 1 {
                <View<T>>::new_unchecked(&self.data[(orig_pos + offset) as usize..])
            } else {
                <View<T>>::new_unchecked(&self.data[orig_pos as usize..])
            }
        } else {
            <View<T>>::new_unchecked(&self.data[orig_pos as usize..])
        }
    }
}

impl Deref for View<Vec<u8>> {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        let mut stream = FracInputStream::new(&self.data);
        <&[u8]>::unpack(&mut stream).unwrap()
    }
}

impl Deref for View<&[u8]> {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        let mut stream = FracInputStream::new(&self.data);
        <&[u8]>::unpack(&mut stream).unwrap()
    }
}

impl Deref for View<String> {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(&self.data);
        <&str>::unpack(&mut stream).unwrap()
    }
}

impl Deref for View<&str> {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(&self.data);
        <&str>::unpack(&mut stream).unwrap()
    }
}
