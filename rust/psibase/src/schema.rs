use crate::reflect::{self, NamedVisitor};
use crate::reflect::{EnumVisitor, Reflect, StructVisitor, UnnamedVisitor, Visitor};
use fracpack::Fracpack;
use serde::{Deserialize, Serialize};
use std::{any::TypeId, borrow::Cow, cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Debug, Clone, Default, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Schema<String> {
    pub userTypes: Vec<Definition<String>>,
}

#[derive(Debug, Clone, Default, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Definition<String> {
    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<TypeRef<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub structFields: Option<Vec<Field<String>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub unionFields: Option<Vec<Field<String>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub customJson: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub definitionWillNotChange: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub methods: Option<Vec<Method<String>>>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_camel_case_types)]
pub enum TypeRef<String> {
    builtinType(String),
    userType(String),
    vector(Box<TypeRef<String>>),
    optional(Box<TypeRef<String>>),
    tuple(Vec<TypeRef<String>>),
    array(Box<TypeRef<String>>, u32),
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Field<String> {
    name: String,
    ty: TypeRef<String>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Method<String> {
    name: String,
    returns: TypeRef<String>,
    args: Vec<Field<String>>,
}

type BuildString = Rc<RefCell<Cow<'static, str>>>;

fn extract_str(str: &BuildString) -> String {
    Rc::make_mut(&mut str.clone()).take().into_owned()
}

pub fn create_schema<T: Reflect>() -> Schema<BuildString> {
    let mut builder: SchemaBuilder = Default::default();
    builder.get_type_ref::<T>();
    // TODO: handle duplicate names
    builder.schema
}

struct BuiltType {
    _name: Option<BuildString>, // TODO
    type_ref: TypeRef<BuildString>,
}

#[derive(Default)]
struct SchemaBuilder {
    types: HashMap<TypeId, BuiltType>,
    schema: Schema<BuildString>,
}

impl SchemaBuilder {
    fn get_type_ref<T: Reflect>(&mut self) -> TypeRef<BuildString> {
        let type_id = TypeId::of::<T::StaticType>();
        if let Some(tr) = self.types.get(&type_id) {
            tr.type_ref.clone()
        } else {
            T::StaticType::reflect(TypeBuilder {
                schema_builder: self,
                custom_json: None,
                definition_will_not_change: None,
            })
        }
    }

    fn insert<T: Reflect>(
        &mut self,
        name: Option<BuildString>,
        type_ref: TypeRef<BuildString>,
    ) -> &mut BuiltType {
        self.types
            .entry(TypeId::of::<T::StaticType>())
            .or_insert(BuiltType {
                _name: name,
                type_ref,
            })
    }
}

struct TypeBuilder<'a> {
    schema_builder: &'a mut SchemaBuilder,
    custom_json: Option<bool>,
    definition_will_not_change: Option<bool>,
}

impl<'a> Visitor for TypeBuilder<'a> {
    type Return = TypeRef<BuildString>;
    type TupleVisitor = TupleBuilder<'a>;
    type StructTupleVisitor = StructTupleBuilder<'a>;
    type StructVisitor = StructBuilder<'a>;
    type EnumVisitor = EnumBuilder<'a>;

    fn custom_json(mut self) -> Self {
        self.custom_json = Some(true);
        self
    }

    fn definition_will_not_change(mut self) -> Self {
        self.definition_will_not_change = Some(true);
        self
    }

    fn builtin<T: Reflect>(self, name: &'static str) -> Self::Return {
        let name = Rc::new(RefCell::new(name.into()));
        self.schema_builder
            .insert::<T>(Some(name.clone()), TypeRef::builtinType(name))
            .type_ref
            .clone()
    }

    fn refed<Inner: Reflect>(self) -> Self::Return {
        self.schema_builder.get_type_ref::<Inner>()
    }

    fn mut_ref<Inner: Reflect>(self) -> Self::Return {
        self.schema_builder.get_type_ref::<Inner>()
    }

    fn boxed<Inner: Reflect>(self) -> Self::Return {
        self.schema_builder.get_type_ref::<Inner>()
    }

    fn rc<Inner: Reflect>(self) -> Self::Return {
        self.schema_builder.get_type_ref::<Inner>()
    }

    fn arc<Inner: Reflect>(self) -> Self::Return {
        self.schema_builder.get_type_ref::<Inner>()
    }

    fn container<T: Reflect, Inner: Reflect>(self) -> Self::Return {
        let inner = self.schema_builder.get_type_ref::<Inner>();
        self.schema_builder
            .insert::<T>(None, TypeRef::vector(Box::new(inner)))
            .type_ref
            .clone()
    }

    fn array<Inner: Reflect, const SIZE: usize>(self) -> Self::Return {
        let inner = self.schema_builder.get_type_ref::<Inner>();
        self.schema_builder
            .insert::<[Inner; SIZE]>(None, TypeRef::array(Box::new(inner), SIZE as u32))
            .type_ref
            .clone()
    }

    fn tuple<T: Reflect>(self, fields_len: usize) -> TupleBuilder<'a> {
        TupleBuilder {
            schema_builder: self.schema_builder,
            fields: Vec::with_capacity(fields_len),
            type_id: TypeId::of::<T::StaticType>(),
        }
    }

    fn struct_single<T: Reflect, Inner: Reflect>(self, name: Cow<'static, str>) -> Self::Return {
        let inner = self.schema_builder.get_type_ref::<Inner>();
        let name = Rc::new(RefCell::new(name));
        self.schema_builder.schema.userTypes.push(Definition {
            name: name.clone(),
            alias: Some(inner),
            structFields: None,
            unionFields: None,
            customJson: None,
            definitionWillNotChange: None,
            methods: None,
        });
        self.schema_builder
            .insert::<T>(Some(name.clone()), TypeRef::userType(name))
            .type_ref
            .clone()
    }

    fn struct_tuple<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::StructTupleVisitor {
        let name = Rc::new(RefCell::new(name));
        let type_ref = self
            .schema_builder
            .insert::<T>(Some(name.clone()), TypeRef::userType(name.clone()))
            .type_ref
            .clone();
        StructTupleBuilder {
            schema_builder: self.schema_builder,
            name,
            type_ref,
            fields: Vec::with_capacity(fields_len),
        }
    }

    fn struct_named<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::StructVisitor {
        let name = Rc::new(RefCell::new(name));
        let type_ref = self
            .schema_builder
            .insert::<T>(Some(name.clone()), TypeRef::userType(name.clone()))
            .type_ref
            .clone();
        StructBuilder {
            schema_builder: self.schema_builder,
            name,
            type_ref,
            custom_json: self.custom_json,
            definition_will_not_change: self.definition_will_not_change,
            fields: Vec::with_capacity(fields_len),
        }
    }

    fn enumeration<T: Reflect>(
        self,
        name: Cow<'static, str>,
        fields_len: usize,
    ) -> Self::EnumVisitor {
        let name = Rc::new(RefCell::new(name));
        let type_ref = self
            .schema_builder
            .insert::<T>(Some(name.clone()), TypeRef::userType(name.clone()))
            .type_ref
            .clone();
        EnumBuilder {
            schema_builder: self.schema_builder,
            name,
            type_ref,
            fields: Vec::with_capacity(fields_len),
        }
    }
}

struct TupleBuilder<'a> {
    schema_builder: &'a mut SchemaBuilder,
    fields: Vec<TypeRef<BuildString>>,
    type_id: TypeId,
}

impl<'a> UnnamedVisitor<TypeRef<BuildString>> for TupleBuilder<'a> {
    fn field<T: Reflect>(mut self) -> Self {
        self.fields.push(self.schema_builder.get_type_ref::<T>());
        self
    }

    fn end(self) -> TypeRef<BuildString> {
        self.schema_builder
            .types
            .entry(self.type_id)
            .or_insert(BuiltType {
                _name: None,
                type_ref: TypeRef::tuple(self.fields),
            })
            .type_ref
            .clone()
    }
}

struct StructTupleBuilder<'a> {
    schema_builder: &'a mut SchemaBuilder,
    name: BuildString,
    type_ref: TypeRef<BuildString>,
    fields: Vec<TypeRef<BuildString>>,
}

impl<'a> UnnamedVisitor<TypeRef<BuildString>> for StructTupleBuilder<'a> {
    fn field<T: Reflect>(mut self) -> Self {
        self.fields.push(self.schema_builder.get_type_ref::<T>());
        self
    }

    fn end(self) -> TypeRef<BuildString> {
        self.schema_builder.schema.userTypes.push(Definition {
            name: self.name,
            alias: Some(TypeRef::tuple(self.fields)),
            structFields: None,
            unionFields: None,
            customJson: None,
            definitionWillNotChange: None,
            methods: None,
        });
        self.type_ref
    }
}

struct StructBuilder<'a> {
    schema_builder: &'a mut SchemaBuilder,
    name: BuildString,
    type_ref: TypeRef<BuildString>,
    custom_json: Option<bool>,
    definition_will_not_change: Option<bool>,
    fields: Vec<Field<BuildString>>,
}

impl<'a> NamedVisitor<TypeRef<BuildString>> for StructBuilder<'a> {
    fn field<T: Reflect>(mut self, name: Cow<'static, str>) -> Self {
        let name = Rc::new(RefCell::new(name));
        self.fields.push(Field {
            name,
            ty: self.schema_builder.get_type_ref::<T>(),
        });
        self
    }

    fn end(self) -> TypeRef<BuildString> {
        self.schema_builder.schema.userTypes.push(Definition {
            name: self.name,
            alias: None,
            structFields: Some(self.fields),
            unionFields: None,
            customJson: self.custom_json,
            definitionWillNotChange: self.definition_will_not_change,
            methods: None,
        });
        self.type_ref
    }
}

impl<'a> StructVisitor<TypeRef<BuildString>> for StructBuilder<'a> {
    type MethodsVisitor = Self;

    fn with_methods(self) -> Self {
        self
    }
}

impl<'a> reflect::MethodsVisitor<TypeRef<BuildString>> for StructBuilder<'a> {}

struct EnumBuilder<'a> {
    schema_builder: &'a mut SchemaBuilder,
    name: BuildString,
    type_ref: TypeRef<BuildString>,
    fields: Vec<Field<BuildString>>,
}

impl<'a> EnumVisitor<TypeRef<BuildString>> for EnumBuilder<'a> {
    type TupleVisitor = EnumTupleBuilder<'a>;
    type NamedVisitor = EnumNamedBuilder<'a>;

    fn single<T: Reflect, Inner: Reflect>(mut self, name: Cow<'static, str>) -> Self {
        self.fields.push(Field {
            name: Rc::new(RefCell::new(name)),
            ty: self.schema_builder.get_type_ref::<Inner>(),
        });
        self
    }

    fn tuple<T: Reflect>(self, name: Cow<'static, str>, fields_len: usize) -> Self::TupleVisitor {
        EnumTupleBuilder {
            enum_builder: self,
            name: Rc::new(RefCell::new(name)),
            fields: Vec::with_capacity(fields_len),
        }
    }

    fn named<T: Reflect>(self, name: Cow<'static, str>, fields_len: usize) -> Self::NamedVisitor {
        EnumNamedBuilder {
            enum_builder: self,
            name: Rc::new(RefCell::new(name)),
            fields: Vec::with_capacity(fields_len),
        }
    }

    fn end(self) -> TypeRef<BuildString> {
        self.schema_builder.schema.userTypes.push(Definition {
            name: self.name,
            alias: None,
            structFields: None,
            unionFields: Some(self.fields),
            customJson: None,
            definitionWillNotChange: None,
            methods: None,
        });
        self.type_ref
    }
}

struct EnumTupleBuilder<'a> {
    enum_builder: EnumBuilder<'a>,
    name: BuildString,
    fields: Vec<TypeRef<BuildString>>,
}

impl<'a> UnnamedVisitor<EnumBuilder<'a>> for EnumTupleBuilder<'a> {
    fn field<T: Reflect>(mut self) -> Self {
        self.fields
            .push(self.enum_builder.schema_builder.get_type_ref::<T>());
        self
    }

    fn end(mut self) -> EnumBuilder<'a> {
        self.enum_builder.fields.push(Field {
            name: self.name,
            ty: TypeRef::tuple(self.fields),
        });
        self.enum_builder
    }
}

struct EnumNamedBuilder<'a> {
    enum_builder: EnumBuilder<'a>,
    name: BuildString,
    fields: Vec<Field<BuildString>>,
}

impl<'a> NamedVisitor<EnumBuilder<'a>> for EnumNamedBuilder<'a> {
    fn field<T: Reflect>(mut self, name: Cow<'static, str>) -> Self {
        self.fields.push(Field {
            name: Rc::new(RefCell::new(name)),
            ty: self.enum_builder.schema_builder.get_type_ref::<T>(),
        });
        self
    }

    fn end(mut self) -> EnumBuilder<'a> {
        let struct_name = Rc::new(RefCell::new(Cow::Owned(
            extract_str(&self.enum_builder.name) + "::" + self.name.as_ref().borrow().as_ref(),
        )));
        self.enum_builder
            .schema_builder
            .schema
            .userTypes
            .push(Definition {
                name: struct_name.clone(),
                alias: None,
                structFields: Some(self.fields),
                unionFields: None,
                customJson: None,
                definitionWillNotChange: None,
                methods: None,
            });
        self.enum_builder.fields.push(Field {
            name: self.name,
            ty: TypeRef::userType(struct_name),
        });
        self.enum_builder
    }
}
