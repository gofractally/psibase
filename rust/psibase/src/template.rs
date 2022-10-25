use crate::reflect::{
    ArgVisitor, IgnoreVisit, MethodsVisitor, NamedVisitor, Reflect, StructVisitor, UnnamedVisitor,
    Visitor,
};
use serde_json::to_string;

pub fn generate_template<T: Reflect>() -> String {
    let mut result = String::new();
    T::reflect(TemplateGenerator(&mut result));
    result
}

struct TemplateGenerator<'a>(&'a mut String);

impl<'a> Visitor for TemplateGenerator<'a> {
    type Return = ();
    type TupleVisitor = IgnoreVisit<()>;
    type StructTupleVisitor = IgnoreVisit<()>;
    type StructVisitor = Self;
    type EnumVisitor = IgnoreVisit<()>;

    fn struct_named<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::StructVisitor {
        self
    }

    fn custom_json(self) -> Self {
        unimplemented!()
    }
    fn definition_will_not_change(self) -> Self {
        self
    }
    fn builtin<T: Reflect>(self, _name: &'static str) {
        unimplemented!()
    }
    fn refed<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn mut_ref<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn boxed<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn rc<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn arc<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn cell<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn ref_cell<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn option<Inner: Reflect>(self) {
        unimplemented!()
    }
    fn container<T: Reflect, Inner: Reflect>(self) {
        unimplemented!()
    }
    fn array<Inner: Reflect, const SIZE: usize>(self) {
        unimplemented!()
    }
    fn tuple<T: Reflect>(self, _fields_len: usize) -> Self::TupleVisitor {
        unimplemented!()
    }
    fn struct_single<T: Reflect, Inner: Reflect>(self, _name: std::borrow::Cow<'static, str>) {
        unimplemented!()
    }
    fn struct_tuple<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::StructTupleVisitor {
        unimplemented!()
    }
    fn enumeration<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::EnumVisitor {
        unimplemented!()
    }
}

impl<'a> NamedVisitor<()> for TemplateGenerator<'a> {
    fn field<T: Reflect>(self, _name: std::borrow::Cow<'static, str>) -> Self {
        self
    }
    fn end(self) {}
}

impl<'a> StructVisitor<()> for TemplateGenerator<'a> {
    type MethodsVisitor = Self;

    fn with_methods(self, _num_methods: usize) -> Self::MethodsVisitor {
        self
    }
}

impl<'a> MethodsVisitor<()> for TemplateGenerator<'a> {
    type ArgVisitor = ArgsGenerator<'a>;

    fn method<MethodReturn: Reflect>(
        self,
        name: std::borrow::Cow<'static, str>,
        _num_args: usize,
    ) -> Self::ArgVisitor {
        self.0.push_str(&to_string(&name).unwrap());
        self.0.push_str(":{");
        ArgsGenerator {
            result: self.0,
            first: true,
        }
    }
    fn end(self) {}
}

struct ArgsGenerator<'a> {
    result: &'a mut String,
    first: bool,
}

impl<'a> ArgVisitor<TemplateGenerator<'a>> for ArgsGenerator<'a> {
    fn arg<T: Reflect>(mut self, name: std::borrow::Cow<'static, str>) -> Self {
        if !self.first {
            self.result.push(',');
        }
        self.first = false;
        self.result.push_str(&to_string(&name).unwrap());
        self.result.push(':');
        T::reflect(ValueGenerator {
            result: self.result,
            skip: false,
        });
        self
    }
    fn end(self) -> TemplateGenerator<'a> {
        self.result.push('}');
        TemplateGenerator(self.result)
    }
}

struct ValueGenerator<'a> {
    result: &'a mut String,
    skip: bool,
}

impl<'a> Visitor for ValueGenerator<'a> {
    type Return = ();
    type TupleVisitor = FieldGenerator<'a>;
    type StructTupleVisitor = FieldGenerator<'a>;
    type StructVisitor = FieldGenerator<'a>;
    type EnumVisitor = IgnoreVisit<()>;

    fn custom_json(mut self) -> Self {
        if !self.skip {
            self.result.push_str("\"\"");
            self.skip = true;
        }
        self
    }
    fn definition_will_not_change(self) -> Self {
        self
    }
    fn builtin<T: Reflect>(self, name: &'static str) {
        if !self.skip {
            match name {
                "bool" => self.result.push_str("false"),
                "u8" => self.result.push('0'),
                "u16" => self.result.push('0'),
                "u32" => self.result.push('0'),
                "u64" => self.result.push('0'),
                "i8" => self.result.push('0'),
                "i16" => self.result.push('0'),
                "i32" => self.result.push('0'),
                "i64" => self.result.push('0'),
                "f32" => self.result.push('0'),
                "f64" => self.result.push('0'),
                "string" => self.result.push_str("\"\""),
                _ => self.result.push('?'),
            }
        }
    }
    fn refed<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn mut_ref<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn boxed<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn rc<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn arc<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn cell<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn ref_cell<Inner: Reflect>(self) {
        Inner::reflect(self)
    }
    fn option<Inner: Reflect>(self) {
        if !self.skip {
            self.result.push_str("null");
        }
    }
    fn container<T: Reflect, Inner: Reflect>(self) {
        if !self.skip {
            self.result.push_str("[]");
        }
    }
    fn array<Inner: Reflect, const SIZE: usize>(self) {
        if !self.skip {
            self.result.push_str("[]");
        }
    }
    fn tuple<T: Reflect>(self, _fields_len: usize) -> Self::TupleVisitor {
        if !self.skip {
            self.result.push('[');
        }
        FieldGenerator {
            result: self.result,
            first: true,
        }
    }
    fn struct_single<T: Reflect, Inner: Reflect>(self, _name: std::borrow::Cow<'static, str>) {
        if !self.skip {
            T::reflect(self)
        }
    }
    fn struct_tuple<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::StructTupleVisitor {
        if !self.skip {
            self.result.push('[')
        }
        FieldGenerator {
            result: self.result,
            first: true,
        }
    }
    fn struct_named<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::StructVisitor {
        if !self.skip {
            self.result.push('{')
        }
        FieldGenerator {
            result: self.result,
            first: true,
        }
    }
    fn enumeration<T: Reflect>(
        self,
        _name: std::borrow::Cow<'static, str>,
        _fields_len: usize,
    ) -> Self::EnumVisitor {
        if !self.skip {
            self.result.push_str("{}");
        }
        IgnoreVisit(())
    }
}

struct FieldGenerator<'a> {
    result: &'a mut String,
    first: bool,
}

impl<'a> UnnamedVisitor<()> for FieldGenerator<'a> {
    fn field<T: Reflect>(mut self) -> Self {
        if !self.first {
            self.result.push(',');
        }
        self.first = false;
        T::reflect(ValueGenerator {
            result: self.result,
            skip: false,
        });
        self
    }
    fn end(self) {}
}

impl<'a> NamedVisitor<()> for FieldGenerator<'a> {
    fn field<T: Reflect>(mut self, name: std::borrow::Cow<'static, str>) -> Self {
        if !self.first {
            self.result.push(',');
        }
        self.first = false;
        self.result.push_str(&to_string(&name).unwrap());
        self.result.push(':');
        T::reflect(ValueGenerator {
            result: self.result,
            skip: false,
        });
        self
    }
    fn end(self) {
        self.result.push('}');
    }
}

impl<'a> StructVisitor<()> for FieldGenerator<'a> {
    type MethodsVisitor = IgnoreVisit<()>;

    fn with_methods(self, _num_methods: usize) -> Self::MethodsVisitor {
        IgnoreVisit(())
    }
}
