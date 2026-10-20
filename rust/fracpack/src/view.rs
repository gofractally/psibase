#![allow(unused)]

use crate::{FracInputStream, Result, Unpack};
use std::marker::PhantomData;
use std::ops::{Deref, Index};
use std::{cell::RefCell, rc::Rc, sync::Arc};

pub trait MakeView {
    type ViewType: ViewData + ?Sized;
}

pub trait ViewData {
    fn new_unchecked(data: &[u8]) -> &Self;
    fn get_data(&self) -> &[u8];
}

pub trait ViewExt<'a>: ViewData {
    type ValueType: Unpack<'a>;
    fn unpack(&'a self) -> Self::ValueType {
        let mut stream = FracInputStream::new(self.get_data());
        if Self::ValueType::IS_OPTIONAL {
            stream.known_end = false;
            let mut fixed_pos = 0;
            Self::ValueType::embedded_unpack(&mut stream, &mut fixed_pos).unwrap()
        } else {
            Self::ValueType::unpack(&mut stream).unwrap()
        }
    }
    fn new(data: &'a [u8]) -> Result<&'a Self> {
        Self::ValueType::verify_no_extra(data)?;
        Ok(Self::new_unchecked(data))
    }
}

pub type View<T> = <T as MakeView>::ViewType;

macro_rules! view {
    ( $vis:vis $name:ident : $value:ty ) => {
        #[repr(transparent)]
        pub struct $name([u8]);
        impl $crate::MakeView for $value {
            type ViewType = $name;
        }
        impl $crate::ViewData for $name {
            fn new_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data as *const [u8] as *const Self) }
            }
            fn get_data(&self) -> &[u8] {
                return &self.0;
            }
        }
        impl<'a> $crate::ViewExt<'a> for $name {
            type ValueType = $value;
        }
    };
    ( $vis:vis $name:ident<$($param:ident),+> : $value:ty ) => {
        #[repr(transparent)]
        pub struct $name<$($param),+> {
            _phantom: PhantomData<($($param),+)>,
            data: [u8],
        }
        impl<$($param),+> $crate::MakeView for $value {
            type ViewType = $name<$($param),+>;
        }
        impl<$($param),+> $crate::ViewData for $name<$($param),+> {
            fn new_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data as *const [u8] as *const Self) }
            }
            fn get_data(&self) -> &[u8] {
                return &self.data;
            }
        }
        impl<'a, $($param),+> $crate::ViewExt<'a> for $name<$($param),+> where $value: Unpack<'a>  {
            type ValueType = $value;
        }
    };
    ( $vis:vis <$l:lifetime> $name:ident : $value:ty ) => {
        #[repr(transparent)]
        pub struct $name([u8]);
        impl<$l> $crate::MakeView for $value {
            type ViewType = $name;
        }
        impl<$l> $crate::ViewData for $name {
            fn new_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data as *const [u8] as *const Self) }
            }
            fn get_data(&self) -> &[u8] {
                return &self.0;
            }
        }
        impl<$l> $crate::ViewExt<$l> for $name {
            type ValueType = $value;
        }
    }
}

view!(pub StringView: String);

/*
#[repr(transparent)]
pub struct StringView(ViewData<String>);
impl MakeView for String {
    type ViewType = StringView;
}
impl<'a> ViewExt<'a> for StringView {
    type ValueType = String;
    fn new_unchecked(data: &'a [u8]) -> &'a Self {
        unsafe { &*(data as *const [u8] as *const Self) }
    }
    fn get_data(&'a self) -> &'a [u8] {
        return &self.0.data;
    }
}
*/

impl Deref for StringView {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(self.get_data());
        <&str>::unpack(&mut stream).unwrap()
    }
}

view!(pub <'a> StrView: &'a str);

impl Deref for StrView {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(self.get_data());
        <&str>::unpack(&mut stream).unwrap()
    }
}

view!(pub VecView<T>: Vec<T>);

impl<'a, T: MakeView + Unpack<'a>> Index<usize> for VecView<T> {
    type Output = View<T>;
    fn index(&self, index: usize) -> &Self::Output {
        let stream = FracInputStream::new(&self.data);
        let orig_pos = 4 + T::FIXED_SIZE * index as u32;
        if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
            let mut fixed_pos = orig_pos;
            let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
            <View<T>>::new_unchecked(&self.data[(orig_pos + offset) as usize..])
        } else {
            <View<T>>::new_unchecked(&self.data[orig_pos as usize..])
        }
    }
}

// Usage should be &View<T>

// view!(pub BoxView<T>: Box<T>);

/*
impl<T> View<T> {
    fn new_unchecked<'b>(data: &'b [u8]) -> &'b View<T> {
        unsafe { &*(data as *const [u8] as *const View<T>) }
    }
}

impl<'a, T: Unpack<'a>> View<T> {
    pub fn new<'b>(data: &'b [u8]) -> Result<&'b View<T>> {
        T::verify_no_extra(data)?;
        Ok(<View<T>>::new_unchecked(data))
    }
    pub fn unpack(&'a self) -> T {
        let mut stream = FracInputStream::new(&self.data);
        if T::IS_OPTIONAL {
            stream.known_end = false;
            let mut fixed_pos = 0;
            T::embedded_unpack(&mut stream, &mut fixed_pos).unwrap()
        } else {
            T::unpack(&mut stream).unwrap()
        }
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
            <View<T>>::new_unchecked(&self.data[(orig_pos + offset) as usize..])
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

impl<T> Deref for View<Box<T>> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

impl<T> Deref for View<Rc<T>> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

impl<T> Deref for View<Arc<T>> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

impl<T> Deref for View<RefCell<T>> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

const EMPTY_OPTION: [u8; 4] = [1, 0, 0, 0];

pub fn get_member<'a, T: Unpack<'a>, U>(view: &View<U>, fixed_offset: u32) -> &View<T> {
    let mut stream = FracInputStream::new(&view.data);
    let fixed_size = u16::unpack(&mut stream).unwrap() as u32;
    let orig_pos = fixed_offset + stream.pos;
    if T::IS_OPTIONAL && fixed_size <= fixed_offset {
        <View<T>>::new_unchecked(&EMPTY_OPTION)
    } else if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
        let mut fixed_pos = orig_pos;
        let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
        <View<T>>::new_unchecked(&view.data[(orig_pos + offset) as usize..])
    } else {
        <View<T>>::new_unchecked(&view.data[orig_pos as usize..])
    }
}

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident $getn:ident)*))+) => {
        $(
            impl<'a, $($name: Unpack<'a>),*> View<($($name,)*)> {
                #[allow(unused)]
                const fn get_offsets() -> [u32; $len] {
                    let mut result = [0; $len];
                    let mut pos = 0;
                    $(
                        result[$n] = pos;
                        pos += $name::FIXED_SIZE;
                    )*
                    result
                }
                pub fn get(&self) -> ($(&View<$name>,)*) { ($(self.$getn(),)*)}
                $(
                    pub fn $getn(&self) -> &View<$name> {
                        get_member(self, Self::get_offsets()[$n])
                    }
                )*
            }
        )+
    }
}

tuple_impls! {
    0 => ()
    1 => (0 T0 get0)
    2 => (0 T0 get0 1 T1 get1)
    3 => (0 T0 get0 1 T1 get1 2 T2 get2)
    4 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3)
    5 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4)
    6 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5)
    7 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6)
    8 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7)
    9 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8)
    10 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9)
    11 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10)
    12 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10 11 T11 get11)
    13 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10 11 T11 get11 12 T12 get12)
    14 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10 11 T11 get11 12 T12 get12 13 T13 get13)
    15 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10 11 T11 get11 12 T12 get12 13 T13 get13 14 T14 get14)
    16 => (0 T0 get0 1 T1 get1 2 T2 get2 3 T3 get3 4 T4 get4 5 T5 get5 6 T6 get6 7 T7 get7 8 T8 get8 9 T9 get9 10 T10 get10 11 T11 get11 12 T12 get12 13 T13 get13 14 T14 get14 15 T15 get15)
}
 */
