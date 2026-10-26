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
    const IMPLICIT_FIXED_SIZE: bool;
    fn get_offset(index: usize) -> u32;
    fn get_field<'a, T: MakeView + Unpack<'a>>(&'_ self, index: usize) -> &'_ View<T> {
        let fixed_offset = Self::get_offset(index);
        let mut stream = FracInputStream::new(self.get_data());
        if !Self::IMPLICIT_FIXED_SIZE {
            let fixed_size = u16::unpack(&mut stream).unwrap() as u32;
            if T::IS_OPTIONAL && fixed_size <= fixed_offset {
                return <View<T>>::new_unchecked(&EMPTY_OPTION);
            }
        }
        let orig_pos = fixed_offset + stream.pos;
        if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
            let mut fixed_pos = orig_pos;
            let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
            <View<T>>::new_unchecked(&self.get_data()[(orig_pos + offset) as usize..])
        } else {
            <View<T>>::new_unchecked(&self.get_data()[orig_pos as usize..])
        }
    }
}

#[repr(transparent)]
pub struct GenericView<T> {
    _phantom: PhantomData<T>,
    data: [u8],
}
impl<T> ViewData for GenericView<T> {
    fn new_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data as *const [u8] as *const Self) }
    }
    fn get_data(&self) -> &[u8] {
        return &self.data;
    }
}
impl<'a, T> ViewExt<'a> for GenericView<T>
where
    T: Unpack<'a>,
{
    type ValueType = T;
}
impl<'a, T: Unpack<'a> + std::fmt::Debug> std::fmt::Debug for &'a GenericView<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::result::Result<(), std::fmt::Error> {
        self.unpack().fmt(f)
    }
}

#[repr(transparent)]
pub struct RefView<T: ?Sized> {
    _phantom: PhantomData<T>,
    data: [u8],
}
impl<T: ?Sized> ViewData for RefView<T> {
    fn new_unchecked(data: &[u8]) -> &Self {
        unsafe { &*(data as *const [u8] as *const Self) }
    }
    fn get_data(&self) -> &[u8] {
        return &self.data;
    }
}
impl<'a, T: ?Sized + 'a> ViewExt<'a> for RefView<T>
where
    &'a T: Unpack<'a>,
{
    type ValueType = &'a T;
}
impl<'a, T: ?Sized + std::fmt::Debug + 'a> std::fmt::Debug for &'a RefView<T>
where
    &'a T: Unpack<'a>,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::result::Result<(), std::fmt::Error> {
        self.unpack().fmt(f)
    }
}

macro_rules! generic_view {
    ( $ty:ty ) => {
        impl MakeView for $ty {
            type ViewType = GenericView<$ty>;
        }
    };
    ( $alias:ident $(<$param:ident>)? : $ty:ty ) => {
        type $alias $(<$param>)? = GenericView<$ty>;
        impl $(<$param>)? MakeView for $ty {
            type ViewType = GenericView<$ty>;
        }
    }
}

generic_view!(StringView: String);

impl Deref for StringView {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(self.get_data());
        <&str>::unpack(&mut stream).unwrap()
    }
}

type StrView = RefView<str>;
impl<'a> MakeView for &'a str {
    type ViewType = StrView;
}

impl Deref for StrView {
    type Target = str;
    fn deref(&self) -> &str {
        let mut stream = FracInputStream::new(self.get_data());
        <&str>::unpack(&mut stream).unwrap()
    }
}

generic_view!(VecView<T>: Vec<T>);

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

type BytesView = RefView<[u8]>;
impl<'a> MakeView for &'a [u8] {
    type ViewType = BytesView;
}

impl Deref for BytesView {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        let mut stream = FracInputStream::new(self.get_data());
        <&[u8]>::unpack(&mut stream).unwrap()
    }
}

type ArrayView<T, const N: usize> = GenericView<[T; N]>;
impl<T, const N: usize> MakeView for [T; N] {
    type ViewType = ArrayView<T, N>;
}

impl<'a, T: MakeView + Unpack<'a>, const N: usize> Index<usize> for ArrayView<T, N> {
    type Output = View<T>;
    fn index(&self, index: usize) -> &Self::Output {
        assert!(index < N);
        let stream = FracInputStream::new(&self.data);
        let orig_pos = T::FIXED_SIZE * index as u32;
        if T::VARIABLE_SIZE && !T::IS_OPTIONAL {
            let mut fixed_pos = orig_pos;
            let offset = stream.unpack_at::<u32>(&mut fixed_pos).unwrap();
            <View<T>>::new_unchecked(&self.data[(orig_pos + offset) as usize..])
        } else {
            <View<T>>::new_unchecked(&self.data[orig_pos as usize..])
        }
    }
}

impl<'a, T: MakeView + Unpack<'a>, const N: usize> ArrayView<T, N> {
    pub fn map<U, F: FnMut(&'a View<T>) -> U>(&'a self, mut f: F) -> [U; N] {
        let mut indices = [0usize; N];
        for (i, r) in indices.iter_mut().enumerate() {
            *r = i;
        }
        indices.map(move |i| f(&self[i]))
    }
    pub fn transpose(&'a self) -> [&'a View<T>; N] {
        self.map(|x| x)
    }
    pub fn iter(&'a self) -> ViewIterator<'a, T> {
        let mut pos = 0;
        let stream = FracInputStream::new(&self.get_data());
        let size = N as u32 * T::FIXED_SIZE;
        ViewIterator {
            data: self.get_data(),
            pos: 0,
            end: size,
            _phantom: Default::default(),
        }
    }
}

impl<'a, T: MakeView + Unpack<'a>, const N: usize> IntoIterator for &'a ArrayView<T, N> {
    type Item = &'a View<T>;
    type IntoIter = ViewIterator<'a, T>;
    fn into_iter(self) -> ViewIterator<'a, T> {
        self.iter()
    }
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

generic_view!(OptionView<T>: Option<T>);

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
    fn is_some(&self) -> bool;
}

impl<'a, T> OptionLike for &'a OptionView<T> {
    fn make_none() -> Self {
        <OptionView<T>>::new_unchecked(&EMPTY_OPTION)
    }
    fn is_some(&self) -> bool {
        (*self).is_some()
    }
}

impl<T> OptionLike for Option<T> {
    fn make_none() -> Self {
        None
    }
    fn is_some(&self) -> bool {
        self.is_some()
    }
}

pub trait CommonOption<T> {
    fn make_common(opt: T) -> Self;
}

impl<'a, T> CommonOption<&'a OptionView<T>> for &'a OptionView<T> {
    fn make_common(opt: &'a OptionView<T>) -> &'a OptionView<T> {
        opt
    }
}
impl<'a, T: MakeView> CommonOption<&'a OptionView<T>> for Option<&'a View<T>> {
    fn make_common(opt: &'a OptionView<T>) -> Option<&'a View<T>> {
        opt.get()
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
    pub fn or<'a, U: CommonOption<&'a Self>>(&'a self, optb: U) -> U {
        if self.is_some() {
            U::make_common(self)
        } else {
            optb
        }
    }
    pub fn or_else<'a, U: CommonOption<&'a Self>, F: FnOnce() -> U>(&'a self, f: F) -> U {
        if self.is_some() {
            U::make_common(self)
        } else {
            f()
        }
    }
    pub fn xor<'a, U: OptionLike + CommonOption<&'a Self>>(&'a self, optb: U) -> U {
        if self.is_some() && optb.is_some() {
            U::make_none()
        } else {
            self.or(optb)
        }
    }
}

impl<T: MakeView> OptionView<T> {
    pub fn and_then<'a, U: OptionLike, F: FnOnce(&'a View<T>) -> U>(&'a self, f: F) -> U {
        if let Some(value) = self.get() {
            f(value)
        } else {
            U::make_none()
        }
    }
    pub fn expect<'a>(&'a self, msg: &'_ str) -> &'a View<T> {
        self.get().expect(msg)
    }
    pub fn filter<'a, P: FnOnce(&'a View<T>) -> bool>(&'a self, pred: P) -> &'a Self {
        if let Some(value) = self.get() {
            if !pred(value) {
                return Self::new_unchecked(&EMPTY_OPTION);
            }
        }
        self
    }
    pub fn inspect<'a, F: FnOnce(&'a View<T>)>(&'a self, f: F) -> &'a Self {
        if let Some(value) = self.get() {
            f(value)
        }
        self
    }
    pub fn is_none_or<'a, F: FnOnce(&'a View<T>) -> bool>(&'a self, f: F) -> bool {
        self.get().is_none_or(f)
    }
    pub fn is_some_and<'a, F: FnOnce(&'a View<T>) -> bool>(&'a self, f: F) -> bool {
        self.get().is_some_and(f)
    }
    pub fn map<'a, U, F: FnOnce(&'a View<T>) -> U>(&'a self, f: F) -> Option<U> {
        self.get().map(f)
    }
    pub fn map_or<'a, U, F: FnOnce(&'a View<T>) -> U>(&'a self, default: U, f: F) -> U {
        self.get().map_or(default, f)
    }
    pub fn map_or_default<'a, U: Default, F: FnOnce(&'a View<T>) -> U>(&'a self, f: F) -> U {
        self.get().map_or_default(f)
    }
    pub fn map_or_else<'a, U, D: FnOnce() -> U, F: FnOnce(&'a View<T>) -> U>(
        &'a self,
        default: D,
        f: F,
    ) -> U {
        self.get().map_or_else(default, f)
    }
    pub fn ok_or<E>(&self, err: E) -> std::result::Result<&View<T>, E> {
        self.get().ok_or(err)
    }
    pub fn ok_or_else<E, F: FnOnce() -> E>(&self, err: F) -> std::result::Result<&View<T>, E> {
        self.get().ok_or_else(err)
    }
    pub fn unwrap(&self) -> &View<T> {
        self.get().unwrap()
    }
    pub fn unwrap_or<'a>(&'a self, default: &'a View<T>) -> &'a View<T> {
        self.get().unwrap_or(default)
    }
    // unwrap_or_default can't be used because views do not implement Default
    pub fn unwrap_or_else<'a, F: FnOnce() -> &'a View<T>>(&'a self, f: F) -> &'a View<T> {
        self.get().unwrap_or_else(f)
    }
}

impl<T> OptionView<Option<T>> {
    pub fn flatten(&self) -> &OptionView<T> {
        self.and_then(|v| v)
    }
}

generic_view!(BoxView<T>: Box<T>);
impl<T: MakeView> Deref for BoxView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

generic_view!(RcView<T>: Rc<T>);
impl<T: MakeView> Deref for RcView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

generic_view!(ArcView<T>: Arc<T>);
impl<T: MakeView> Deref for ArcView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

generic_view!(RefCellView<T>: RefCell<T>);
impl<T: MakeView> Deref for RefCellView<T> {
    type Target = View<T>;
    fn deref(&self) -> &View<T> {
        <View<T>>::new_unchecked(&self.data)
    }
}

type TupleView<T> = GenericView<T>;

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident $getn:ident)*))+) => {
        $(
            impl<$($name,)*> MakeView for ($($name,)*) {
                type ViewType = TupleView<($($name,)*)>;
            }
            impl<'a, $($name: Unpack<'a>),*> ViewFields for TupleView<($($name,)*)> {
                const IMPLICIT_FIXED_SIZE: bool = false;
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
