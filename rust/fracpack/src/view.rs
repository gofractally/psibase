#![allow(unused)]

use crate::{FracInputStream, Result, Unpack};
use std::marker::PhantomData;
use std::ops::{Deref, Index};
use std::{cell::RefCell, rc::Rc, sync::Arc};

// Requirements:
// - The user can specialize traits for views of his own types
// - Using views should mimic regular rust syntax as much as possible

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

const EMPTY_OPTION: [u8; 4] = [1, 0, 0, 0];

pub trait ViewFields: ViewData {
    fn get_offset(index: usize) -> u32;
    fn get_field<'a, T: MakeView + Unpack<'a>>(&'_ self, index: usize) -> &'_ View<T> {
        let fixed_offset = Self::get_offset(index);
        let mut stream = FracInputStream::new(self.get_data());
        let fixed_size = u16::unpack(&mut stream).unwrap() as u32;
        let orig_pos = fixed_offset + stream.pos;
        if T::IS_OPTIONAL && fixed_size <= fixed_offset {
            <View<T>>::new_unchecked(&EMPTY_OPTION)
        } else if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
            let mut fixed_pos = orig_pos;
            let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
            <View<T>>::new_unchecked(&self.get_data()[(orig_pos + offset) as usize..])
        } else {
            <View<T>>::new_unchecked(&self.get_data()[orig_pos as usize..])
        }
    }
}

macro_rules! define_view {
    ( $name:ident ) => {
        #[repr(transparent)]
        pub struct $name<T> {
            _phantom: PhantomData<T>,
            data: [u8],
        }
        impl<T> $crate::ViewData for $name<T> {
            fn new_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data as *const [u8] as *const Self) }
            }
            fn get_data(&self) -> &[u8] {
                return &self.data;
            }
        }
        impl<'a, T> $crate::ViewExt<'a> for $name<T>
        where
            T: Unpack<'a>,
        {
            type ValueType = T;
        }
    };
}

define_view!(GenericView);

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

pub struct ViewIterator<'a, T> {
    data: &'a [u8],
    pos: u32,
    end: u32,
    _phantom: PhantomData<T>,
}

impl<'a, T: MakeView + Unpack<'a>> ViewIterator<'a, T>
where
    T: 'a,
    View<T>: 'a,
{
    pub fn unpacked(self) -> impl Iterator<Item = T> + 'a {
        self.map(|item| {
            let mut stream = FracInputStream::new(item.get_data());
            T::unpack(&mut stream).unwrap()
        })
    }
}

impl<'a, T: MakeView + Unpack<'a>> Iterator for ViewIterator<'a, T>
where
    View<T>: 'a,
{
    type Item = &'a View<T>;
    fn next(&mut self) -> Option<&'a View<T>> {
        if self.pos == self.end {
            None
        } else {
            let orig_pos = self.pos;
            let pos = if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
                let stream = FracInputStream::new(&self.data);
                orig_pos + stream.unpack_at::<u32>(&mut self.pos).unwrap()
            } else {
                self.pos += T::FIXED_SIZE;
                orig_pos
            };
            Some(<View<T>>::new_unchecked(&self.data[pos as usize..]))
        }
    }
}

impl<'a, T: MakeView + Unpack<'a>> IntoIterator for &'a VecView<T> {
    type Item = &'a View<T>;
    type IntoIter = ViewIterator<'a, T>;
    fn into_iter(self) -> ViewIterator<'a, T> {
        self.iter()
    }
}

impl<'a, T: MakeView + Unpack<'a>> VecView<T> {
    pub fn iter(&'a self) -> ViewIterator<'a, T> {
        let mut pos = 0;
        let stream = FracInputStream::new(&self.get_data());
        let size = stream.unpack_at::<u32>(&mut pos).unwrap();
        ViewIterator {
            data: self.get_data(),
            pos,
            end: pos + size,
            _phantom: Default::default(),
        }
    }
}

impl<T> VecView<T> {
    pub fn is_empty(&self) -> bool {
        let mut stream = FracInputStream::new(&self.get_data());
        u32::unpack(&mut stream).unwrap() == 0
    }
}

impl<'a, T: Unpack<'a>> VecView<T> {
    pub fn len(&self) -> usize {
        let mut stream = FracInputStream::new(&self.get_data());
        (u32::unpack(&mut stream).unwrap() / T::FIXED_SIZE) as usize
    }
}

impl Deref for VecView<u8> {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        let mut stream = FracInputStream::new(self.get_data());
        <&[u8]>::unpack(&mut stream).unwrap()
    }
}

view!(pub <'a> BytesView: &'a [u8]);
impl Deref for BytesView {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        let mut stream = FracInputStream::new(self.get_data());
        <&[u8]>::unpack(&mut stream).unwrap()
    }
}

macro_rules! generic_view {
    ( $ty:ty ) => {
        impl MakeView for $ty {
            type ViewType = GenericView<$ty>;
        }
    };
}

generic_view!(u8);
generic_view!(u16);
generic_view!(u32);
generic_view!(u64);
generic_view!(i8);
generic_view!(i16);
generic_view!(i32);
generic_view!(i64);
generic_view!(f32);
generic_view!(f64);
generic_view!(bool);

view!(pub OptionView<T>: Option<T>);

impl<T: MakeView> OptionView<T> {
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

pub trait OptionLike {
    fn make_none() -> Self;
}

impl<'a, T> OptionLike for &'a OptionView<T> {
    fn make_none() -> Self {
        <OptionView<T>>::new_unchecked(&EMPTY_OPTION)
    }
}

impl<T> OptionLike for Option<T> {
    fn make_none() -> Self {
        None
    }
}

impl<T> OptionView<T> {
    pub fn is_some(&self) -> bool {
        let mut stream = FracInputStream::new(&self.data);
        u32::unpack(&mut stream).unwrap() != 1
    }
    pub fn is_none(&self) -> bool {
        !self.is_some()
    }
    pub fn and<U: OptionLike>(&self, optb: U) -> U {
        if self.is_some() {
            optb
        } else {
            U::make_none()
        }
    }
    pub fn and_then<U: OptionLike, F: FnOnce(&View<T>) -> U>(&self, f: F) -> U
    where
        T: MakeView,
    {
        if let Some(value) = self.get() {
            f(value)
        } else {
            U::make_none()
        }
    }
}

view!(pub BoxView<T>: Box<T>);
impl<T: MakeView> Deref for BoxView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

view!(pub RcView<T>: Rc<T>);
impl<T: MakeView> Deref for RcView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

view!(pub ArcView<T>: Arc<T>);
impl<T: MakeView> Deref for ArcView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

view!(pub RefCellView<T>: RefCell<T>);
impl<T: MakeView> Deref for RefCellView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

define_view!(TupleView);

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident $getn:ident)*))+) => {
        $(
            impl<$($name,)*> MakeView for ($($name,)*) {
                type ViewType = TupleView<($($name,)*)>;
            }
            impl<'a, $($name: Unpack<'a>),*> ViewFields for TupleView<($($name,)*)> {
                fn get_offset(index: usize) -> u32 {
                    let sizes: [u32; $len] = [$($name::FIXED_SIZE),*];
                    sizes.into_iter().take(index).sum()
                }
            }
            impl<'a, $($name: MakeView + Unpack<'a>),*> TupleView<($($name,)*)> {
                pub fn get(&self) -> ($(&View<$name>,)*) { ($(self.$getn(),)*)}
                $(
                    pub fn $getn(&self) -> &View<$name> {
                        ViewFields::get_field::<$name>(self, $n)
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
