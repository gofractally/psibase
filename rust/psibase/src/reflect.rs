use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub trait Reflect {
    type StaticType: 'static + Reflect;
    fn reflect<V: Visitor>(visitor: V) -> V::Return;
}

pub trait ReflectNoMethods {
    fn reflect_methods<Return>(visitor: impl StructVisitor<Return>) -> Return;
}

impl<T> ReflectNoMethods for T {
    fn reflect_methods<Return>(visitor: impl StructVisitor<Return>) -> Return {
        visitor.end()
    }
}

pub trait Visitor {
    type Return;
    type TupleVisitor: UnnamedVisitor<Self::Return>;
    type StructTupleVisitor: UnnamedVisitor<Self::Return>;
    type StructVisitor: StructVisitor<Self::Return>;
    type EnumVisitor: EnumVisitor<Self::Return>;

    fn custom_json(self) -> Self;
    fn definition_will_not_change(self) -> Self;

    fn builtin<T: Reflect>(self, name: &'static str) -> Self::Return;
    fn refed<Inner: Reflect>(self) -> Self::Return;
    fn mut_ref<Inner: Reflect>(self) -> Self::Return;
    fn boxed<Inner: Reflect>(self) -> Self::Return;
    fn rc<Inner: Reflect>(self) -> Self::Return;
    fn arc<Inner: Reflect>(self) -> Self::Return;
    fn cell<Inner: Reflect>(self) -> Self::Return;
    fn ref_cell<Inner: Reflect>(self) -> Self::Return;
    fn option<Inner: Reflect>(self) -> Self::Return;
    fn container<T: Reflect, Inner: Reflect>(self) -> Self::Return;
    fn array<Inner: Reflect, const SIZE: usize>(self) -> Self::Return;
    fn tuple<T: Reflect>(self, fields_len: usize) -> Self::TupleVisitor;
    fn struct_single<T: Reflect, Inner: Reflect>(self, name: Cow<'static, str>) -> Self::Return;
    fn struct_tuple<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::StructTupleVisitor;
    fn struct_named<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::StructVisitor;
    fn enumeration<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::EnumVisitor;
}

pub trait UnnamedVisitor<Return> {
    fn field<T: Reflect>(self) -> Self;
    fn end(self) -> Return;
}

pub trait NamedVisitor<Return> {
    fn field<T: Reflect>(self, name: Cow<'static, str>) -> Self;
    fn end(self) -> Return;
}

pub trait StructVisitor<Return>: NamedVisitor<Return> {
    type MethodsVisitor: MethodsVisitor<Return>;

    fn with_methods(self, num_methods: usize) -> Self::MethodsVisitor;
}

pub trait MethodsVisitor<Return>: Sized {
    type ArgVisitor: ArgVisitor<Self>;

    fn method<MethodReturn: Reflect>(
        self,
        name: Cow<'static, str>,
        num_args: usize,
    ) -> Self::ArgVisitor;
    fn end(self) -> Return;
}

pub trait ArgVisitor<Return> {
    fn arg<T: Reflect>(self, name: Cow<'static, str>) -> Self;
    fn end(self) -> Return;
}

pub trait EnumVisitor<Return>: Sized {
    type TupleVisitor: UnnamedVisitor<Self>;
    type NamedVisitor: NamedVisitor<Self>;

    fn single<T: Reflect, Inner: Reflect>(self, name: Cow<'static, str>) -> Self;
    fn tuple<T: Reflect>(self, name: Cow<'static, str>, fields_len: usize) -> Self::TupleVisitor;
    fn named<T: Reflect>(self, name: Cow<'static, str>, fields_len: usize) -> Self::NamedVisitor;
    fn end(self) -> Return;
}

impl<'a, T: Reflect> Reflect for &'a T {
    type StaticType = &'static T::StaticType;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.refed::<T>()
    }
}

impl<'a, T: Reflect> Reflect for &'a mut T {
    type StaticType = &'static mut T::StaticType;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.mut_ref::<T>()
    }
}

impl<T: Reflect> Reflect for Box<T> {
    type StaticType = Box<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.boxed::<T>()
    }
}

impl<T: Reflect> Reflect for Rc<T> {
    type StaticType = Rc<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.rc::<T>()
    }
}

impl<T: Reflect> Reflect for Arc<T> {
    type StaticType = Arc<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.arc::<T>()
    }
}

impl<T: Reflect> Reflect for Cell<T> {
    type StaticType = Cell<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.cell::<T>()
    }
}

impl<T: Reflect> Reflect for RefCell<T> {
    type StaticType = RefCell<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.ref_cell::<T>()
    }
}

impl<T: Reflect> Reflect for Option<T>
where
    T::StaticType: Sized,
{
    type StaticType = Option<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.option::<T>()
    }
}

impl<T: Reflect> Reflect for Vec<T>
where
    T::StaticType: Sized,
{
    type StaticType = Vec<T::StaticType>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.container::<Vec<T>, T>()
    }
}

impl<T: Reflect, const SIZE: usize> Reflect for [T; SIZE]
where
    T::StaticType: Sized,
{
    type StaticType = [T::StaticType; SIZE];
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.array::<T, SIZE>()
    }
}

impl<'a, T: Reflect + 'a> Reflect for &'a [T]
where
    T::StaticType: Sized,
{
    type StaticType = &'static [T::StaticType];
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.container::<&'a [T], T>()
    }
}

impl<'a, T: Reflect + 'a> Reflect for &'a mut [T]
where
    T::StaticType: Sized,
{
    type StaticType = &'static [T::StaticType];
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.container::<&'a mut [T], T>()
    }
}

macro_rules! builtin_impl {
    ($ty:ty, $name:literal) => {
        impl Reflect for $ty {
            type StaticType = $ty;
            fn reflect<V: Visitor>(visitor: V) -> V::Return {
                visitor.builtin::<$ty>($name)
            }
        }
    };
}

pub struct Void;

builtin_impl!(bool, "bool");
builtin_impl!(u8, "u8");
builtin_impl!(u16, "u16");
builtin_impl!(u32, "u32");
builtin_impl!(u64, "u64");
builtin_impl!(i8, "i8");
builtin_impl!(i16, "i16");
builtin_impl!(i32, "i32");
builtin_impl!(i64, "i64");
builtin_impl!(f32, "f32");
builtin_impl!(f64, "f64");
builtin_impl!(String, "string");
builtin_impl!(Void, "void");

impl<'a> Reflect for &'a str {
    type StaticType = &'static str;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.builtin::<&'a str>("string")
    }
}

impl<'a> Reflect for Cow<'a, str> {
    type StaticType = Cow<'static, str>;
    fn reflect<V: Visitor>(visitor: V) -> V::Return {
        visitor.builtin::<Cow<'a, str>>("string")
    }
}

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident)*))+) => {
        $(
            impl<$($name: Reflect),*> Reflect for ($($name,)*)
            where $($name::StaticType: Sized),*
            {
                type StaticType = ($($name::StaticType,)*);

                #[allow(non_snake_case)]
                fn reflect<V: Visitor>(visitor: V) -> V::Return
                {
                    visitor.tuple::<($($name,)*)>($len)
                    $(.field::<$name>())*
                    .end()
                }
            }
        )+
    }
}

// Reflect excludes () to avoid an inconsistency between serde_json and psio::to_json
tuple_impls! {
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
