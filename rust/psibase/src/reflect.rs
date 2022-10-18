use std::{rc::Rc, sync::Arc};

pub trait Reflect {
    type StaticType: Reflect + 'static;
    fn reflect(visitor: impl ReflectVisitor);
}

pub trait ReflectMethods {
    fn reflect(visitor: impl MethodsVisitor);
}

pub trait ReflectVisitor {
    type UnnamedFieldsVisitor: UnnamedFieldsVisitor;
    type NamedFieldsVisitor: NamedFieldsVisitor;
    type EnumFieldsVisitor: EnumFieldsVisitor;

    fn custom_json(self) -> Self;
    fn definition_will_not_change(self) -> Self;

    fn builtin_type(self);
    fn refed<T: Reflect>(self);
    fn mut_ref<T: Reflect>(self);
    fn boxed<T: Reflect>(self);
    fn rc<T: Reflect>(self);
    fn arc<T: Reflect>(self);
    fn vec<T: Reflect>(self);
    fn array<T: Reflect, const SIZE: usize>(self);
    fn tuple(self, fields_len: usize) -> Self::UnnamedFieldsVisitor;
    fn struct_alias<T: Reflect>(self, name: &str);
    fn struct_tuple(self, name: &str, fields_len: usize) -> Self::UnnamedFieldsVisitor;
    fn struct_named(self, name: &str, fields_len: usize) -> Self::NamedFieldsVisitor;
    fn enumeration(self, name: &str) -> Self::EnumFieldsVisitor;
}

pub trait UnnamedFieldsVisitor {
    fn field<T: Reflect>(self) -> Self;
    fn end(self);
}

pub trait NamedFieldsVisitor {
    fn field<T: Reflect>(self, name: &str) -> Self;
    fn end(self);
    fn with_methods<T: ReflectMethods>(self);
}

pub trait MethodsVisitor {}

pub trait EnumFieldsVisitor {}

impl<'a, T: Reflect> Reflect for &'a T {
    type StaticType = &'static T::StaticType;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.refed::<T>()
    }
}

impl<'a, T: Reflect> Reflect for &'a mut T {
    type StaticType = &'static mut T::StaticType;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.mut_ref::<T>()
    }
}

impl<T: Reflect> Reflect for Box<T> {
    type StaticType = Box<T::StaticType>;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.boxed::<T>()
    }
}

impl<T: Reflect> Reflect for Rc<T> {
    type StaticType = Rc<T::StaticType>;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.rc::<T>()
    }
}

impl<T: Reflect> Reflect for Arc<T> {
    type StaticType = Arc<T::StaticType>;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.arc::<T>()
    }
}

impl<T: Reflect> Reflect for Vec<T> {
    type StaticType = Vec<T::StaticType>;
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.vec::<T>()
    }
}

impl<T: Reflect, const SIZE: usize> Reflect for [T; SIZE] {
    type StaticType = [T::StaticType; SIZE];
    fn reflect(visitor: impl ReflectVisitor) {
        visitor.array::<T, SIZE>()
    }
}
