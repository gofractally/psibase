use crate::{Error, Pack, Unpack};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_aux::prelude::deserialize_number_from_string;
use std::any::TypeId;
use std::collections::HashMap;

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub use indexmap;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "crate")]
pub struct Schema(IndexMap<String, AnyType>);

impl Schema {
    pub fn get(&self, name: &str) -> Option<&AnyType> {
        self.0.get(name)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "crate")]
pub enum AnyType {
    Struct(IndexMap<String, AnyType>),
    Object(IndexMap<String, AnyType>),
    Array {
        #[serde(rename = "type")]
        type_: Box<AnyType>,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        len: u64,
    },
    List(Box<AnyType>),
    Option(Box<AnyType>),
    Variant(IndexMap<String, AnyType>),
    Tuple(Vec<AnyType>),
    Int {
        bits: u32,
        #[serde(rename = "isSigned")]
        is_signed: bool,
    },
    Float {
        exp: u32,
        mantissa: u32,
    },
    FracPack(Box<AnyType>),
    Custom {
        #[serde(rename = "type")]
        type_: Box<AnyType>,
        id: String,
    },
    #[serde(untagged)]
    Type(String),
}

impl Default for AnyType {
    fn default() -> Self {
        AnyType::Struct(Default::default())
    }
}

impl AnyType {
    fn as_type(&self) -> &String {
        if let AnyType::Type(name) = self {
            return name;
        } else {
            panic!("expected Type");
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "crate")]
pub struct FunctionType {
    pub params: AnyType,
    pub result: Option<AnyType>,
}

pub struct SchemaBuilder {
    ids: HashMap<TypeId, String>,
    next_id: usize,
    schema: IndexMap<String, AnyType>,
}

struct TypeUseInfo {
    original_name: String,
    names: Vec<String>,
    uses: usize,
}

impl TypeUseInfo {
    fn can_inline(&self) -> bool {
        self.uses <= 1 && self.names.is_empty()
    }
}

struct AliasMap {
    aliases: HashMap<String, usize>,
    types: Vec<TypeUseInfo>,
}

impl AliasMap {
    fn new() -> Self {
        AliasMap {
            aliases: HashMap::new(),
            types: Vec::new(),
        }
    }
    fn resolve(&self, name: &String) -> Option<(&TypeUseInfo, usize)> {
        if let Some(idx) = self.aliases.get(name) {
            return Some((&self.types[*idx], *idx));
        }
        None
    }
    fn resolve_mut(&mut self, name: &String) -> Option<(&mut TypeUseInfo, usize)> {
        if let Some(idx) = self.aliases.get(name) {
            return Some((&mut self.types[*idx], *idx));
        }
        None
    }
}

fn add_ref(aliases: &mut AliasMap, name: &String) {
    aliases.resolve_mut(name).unwrap().0.uses += 1;
}

pub trait VisitTypes {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F);
}

impl VisitTypes for () {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, _f: &mut F) {}
}

macro_rules! visit_tuple {
    ($($id:ident $i:tt)+) => {
        impl<$($id: VisitTypes),+> VisitTypes for ($(&mut $id),+,) {
            fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
                $(self.$i.visit_types(f));+;
            }
        }
    }
}

visit_tuple!(T0 0);
visit_tuple!(T0 0 T1 1);
visit_tuple!(T0 0 T1 1 T2 2);
visit_tuple!(T0 0 T1 1 T2 2 T3 3);
visit_tuple!(T0 0 T1 1 T2 2 T3 3 T4 4);
visit_tuple!(T0 0 T1 1 T2 2 T3 3 T4 4 T5 5);
visit_tuple!(T0 0 T1 1 T2 2 T3 3 T4 4 T5 5 T6 6);

impl VisitTypes for AnyType {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        visit_types(self, f);
    }
}

impl VisitTypes for FunctionType {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        self.params.visit_types(f);
        self.result.visit_types(f);
    }
}

impl<T: VisitTypes> VisitTypes for Option<T> {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        if let Some(t) = self {
            t.visit_types(f)
        }
    }
}

impl<T: VisitTypes> VisitTypes for [&mut T] {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        for t in self {
            t.visit_types(f);
        }
    }
}

impl<K, T: VisitTypes> VisitTypes for IndexMap<K, T> {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        for (_k, t) in self {
            t.visit_types(f);
        }
    }
}

fn visit_types<F: FnMut(&mut AnyType) -> ()>(t: &mut AnyType, f: &mut F) {
    match t {
        AnyType::Struct(members) => {
            for (_, ty) in members {
                visit_types(ty, f);
            }
        }
        AnyType::Object(members) => {
            for (_, ty) in members {
                visit_types(ty, f);
            }
        }
        AnyType::Array { type_, len: _ } => visit_types(type_, f),
        AnyType::List(ty) => visit_types(ty, f),
        AnyType::Option(ty) => visit_types(ty, f),
        AnyType::Variant(members) => {
            for (_, ty) in members {
                visit_types(ty, f);
            }
        }
        AnyType::Tuple(members) => {
            for ty in members {
                visit_types(ty, f);
            }
        }
        AnyType::Int {
            bits: _,
            is_signed: _,
        } => (),
        AnyType::Float {
            exp: _,
            mantissa: _,
        } => (),
        AnyType::FracPack(ty) => visit_types(ty, f),
        AnyType::Custom { type_, id: _ } => visit_types(type_, f),
        AnyType::Type(_) => f(t),
    }
}

fn rewrite<T: VisitTypes + ?Sized>(
    aliases: &AliasMap,
    ty: &mut T,
    schema: &mut HashMap<String, AnyType>,
) {
    ty.visit_types(&mut |t: &mut AnyType| {
        if t.as_type().starts_with('@') {
            if let Some((tinfo, _)) = aliases.resolve(t.as_type()) {
                if tinfo.can_inline() {
                    *t = schema.remove(&tinfo.original_name).unwrap();
                    rewrite(aliases, t, schema);
                } else {
                    *t = AnyType::Type(tinfo.names[0].clone());
                }
            }
        }
    });
}

impl SchemaBuilder {
    pub fn new() -> Self {
        SchemaBuilder {
            ids: HashMap::new(),
            next_id: 0,
            schema: IndexMap::new(),
        }
    }
    pub fn insert_named<T: ToSchema + ?Sized + 'static>(&mut self, name: String) {
        let ty = self.insert::<T>();
        self.schema.insert(name, ty);
    }
    pub fn insert<T: ToSchema + ?Sized + 'static>(&mut self) -> AnyType {
        let mut is_new = false;
        let id = self
            .ids
            .entry(TypeId::of::<T>())
            .or_insert_with(|| {
                is_new = true;
                let res = format!("@{}", self.next_id);
                self.next_id += 1;
                res
            })
            .clone();
        if is_new {
            let ty = T::schema(self);
            self.schema.insert(id.clone(), ty);
        }
        AnyType::Type(id)
    }
    pub fn build(self) -> Schema {
        self.build_ext(&mut ())
    }
    fn resolve_aliases(&self) -> AliasMap {
        let mut aliases = AliasMap::new();
        for (orig_name, orig_ty) in &self.schema {
            let mut names = Vec::new();
            let mut name = orig_name;
            let mut ty = orig_ty;
            let resolved = loop {
                if let Some((tinfo, idx)) = aliases.resolve_mut(name) {
                    tinfo.names.extend(names);
                    break idx;
                }
                if !name.starts_with('@') {
                    names.push(name.clone());
                }
                if let AnyType::Type(other) = ty {
                    name = other;
                    ty = self.schema.get(name).unwrap();
                } else {
                    let idx = aliases.types.len();
                    aliases.aliases.insert(name.clone(), idx);
                    aliases.types.push(TypeUseInfo {
                        original_name: name.clone(),
                        names,
                        uses: 0,
                    });
                    break idx;
                }
            };
            // save aliases to make future lookup faster
            name = orig_name;
            while !aliases.aliases.contains_key(name) {
                aliases.aliases.insert(name.clone(), resolved);
                name = self.schema.get(name).unwrap().as_type();
            }
        }
        aliases
    }
    pub fn build_ext<Ext: VisitTypes + ?Sized>(mut self, ext: &mut Ext) -> Schema {
        let mut aliases = self.resolve_aliases();
        // Count uses of each type
        ext.visit_types(&mut |t: &mut AnyType| {
            add_ref(&mut aliases, t.as_type());
        });
        for (_, ty) in &mut self.schema {
            if !matches!(ty, AnyType::Type(_)) {
                visit_types(ty, &mut |t: &mut AnyType| {
                    add_ref(&mut aliases, t.as_type());
                });
            }
        }
        // assign a canonical name to each type
        let mut next_id: usize = 0;
        for tinfo in &mut aliases.types {
            if tinfo.names.is_empty() && tinfo.uses > 1 {
                tinfo.names.push(format!("@{}", next_id));
                next_id += 1;
            }
        }
        // Split types that need a separate schema entry from types
        // that are inlined
        let mut inlined = HashMap::new();
        let mut types = Vec::new();
        for (name, ty) in self.schema {
            if !matches!(ty, AnyType::Type(_)) {
                let (tinfo, idx) = aliases.resolve_mut(&name).unwrap();
                if tinfo.can_inline() {
                    inlined.insert(name, ty);
                } else {
                    types.push((ty, idx));
                }
            }
        }
        // Move items to the result, translating type names
        let mut result = Schema(IndexMap::new());
        rewrite(&mut aliases, ext, &mut inlined);
        for (mut ty, idx) in types {
            let tinfo = &mut aliases.types[idx];
            let resolved_name = tinfo.names[0].clone();
            for alt in tinfo.names.drain(1..) {
                result.0.insert(alt, AnyType::Type(resolved_name.clone()));
            }
            rewrite(&mut aliases, &mut ty, &mut inlined);
            result.0.insert(resolved_name, ty);
        }

        result
    }
}

pub trait ToSchema {
    fn schema(builder: &mut SchemaBuilder) -> AnyType;
}

macro_rules! int_impl {
    {$t:ty} => {
        impl ToSchema for $t {
            fn schema(_: &mut SchemaBuilder) -> AnyType {
                AnyType::Int{bits: <$t>::BITS, is_signed: <$t>::MIN != 0}
            }
        }
    }
}

int_impl! {u8}
int_impl! {u16}
int_impl! {u32}
int_impl! {u64}
int_impl! {i8}
int_impl! {i16}
int_impl! {i32}
int_impl! {i64}

macro_rules! float_impl {
    {$t:ty} => {
        impl ToSchema for $t {
            fn schema(_: &mut SchemaBuilder) -> AnyType {
                AnyType::Float{exp: (<$t>::MAX_EXP - <$t>::MIN_EXP).ilog2() + 1, mantissa: <$t>::MANTISSA_DIGITS}
            }
        }
    }
}

float_impl! {f32}
float_impl! {f64}

impl ToSchema for bool {
    fn schema(_: &mut SchemaBuilder) -> AnyType {
        AnyType::Custom {
            type_: AnyType::Int {
                bits: 1,
                is_signed: false,
            }
            .into(),
            id: "bool".to_string(),
        }
    }
}

impl<T: ToSchema + 'static> ToSchema for Option<T> {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::Option(builder.insert::<T>().into())
    }
}

impl<T: ToSchema + 'static> ToSchema for Vec<T> {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::List(builder.insert::<T>().into())
    }
}

impl ToSchema for String {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::Custom {
            type_: builder.insert::<Vec<u8>>().into(),
            id: "string".into(),
        }
    }
}

impl<T: ToSchema + 'static, const N: usize> ToSchema for [T; N] {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::Array {
            type_: builder.insert::<T>().into(),
            len: N as u64,
        }
    }
}

impl<T: ToSchema + 'static> ToSchema for [T] {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::List(builder.insert::<T>().into())
    }
}

impl<T: ToSchema + 'static + ?Sized> ToSchema for &'static T {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        builder.insert::<T>().into()
    }
}

impl<T: ToSchema + 'static + ?Sized> ToSchema for &'static mut T {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        builder.insert::<T>().into()
    }
}

macro_rules! ptr_impl {
    {$t:ident} => {
        impl<T: ToSchema + 'static> ToSchema for $t<T> {
            fn schema(builder: &mut SchemaBuilder) -> AnyType {
                builder.insert::<T>()
            }
        }
    }
}

ptr_impl! {Box}
ptr_impl! {Rc}
ptr_impl! {Arc}
ptr_impl! {Cell}
ptr_impl! {RefCell}

macro_rules! tuple_impl {
    ($($id:ident)+) => {
        impl<$($id: ToSchema + 'static),+> ToSchema for ($($id),+,) {
            fn schema(builder: &mut SchemaBuilder) -> AnyType {
                AnyType::Tuple(vec![$(builder.insert::<$id>()),+])
            }
        }
    }
}

impl ToSchema for () {
    fn schema(_builder: &mut SchemaBuilder) -> AnyType {
        AnyType::Tuple(Vec::new())
    }
}

tuple_impl!(T0);
tuple_impl!(T0 T1);
tuple_impl!(T0 T1 T2);
tuple_impl!(T0 T1 T2 T3);
tuple_impl!(T0 T1 T2 T3 T4);
tuple_impl!(T0 T1 T2 T3 T4 T5);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14);
tuple_impl!(T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15);

pub trait CustomHandler {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool;
    fn frac2json(
        &self,
        schema: &CompiledSchema,
        ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, Error>;
}

#[derive(Default)]
pub struct CustomTypes<'a> {
    by_name: HashMap<String, usize>,
    handlers: Vec<&'a dyn CustomHandler>,
}

impl<'a> CustomTypes<'a> {
    pub fn new() -> Self {
        Default::default()
    }
    pub fn insert(&mut self, name: String, handler: &'a dyn CustomHandler) {
        let id = self.handlers.len();
        self.handlers.push(handler);
        self.by_name.insert(name, id);
    }
    fn find(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }
    fn matches(&self, id: usize, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        self.handlers[id].matches(schema, ty)
    }
    fn frac2json(
        &self,
        id: usize,
        schema: &CompiledSchema,
        ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, Error> {
        self.handlers[id].frac2json(schema, ty, src, pos)
    }
}

struct CustomBool;

impl CustomHandler for CustomBool {
    fn matches(&self, _schema: &CompiledSchema, ty: &CompiledType) -> bool {
        matches!(
            ty,
            CompiledType::Int {
                bits: 1,
                is_signed: false
            }
        )
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, Error> {
        Ok(bool::unpack(src, pos)?.into())
    }
}

struct CustomString;

impl CustomHandler for CustomString {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        use CompiledType::*;
        if let List(item) = ty {
            matches!(schema.get_id(*item), Int { bits: 8, .. })
        } else {
            false
        }
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, Error> {
        Ok(String::unpack(src, pos)?.into())
    }
}

struct CustomHex;

impl CustomHandler for CustomHex {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        use CompiledType::*;
        if let List(item) = ty {
            !schema.get_id(*item).is_variable_size()
        } else {
            matches!(ty, FracPack(..)) || !ty.is_variable_size()
        }
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, Error> {
        let len = if ty.is_variable_size() {
            u32::unpack(src, pos)?
        } else {
            ty.fixed_size()
        };
        let start = *pos;
        let end = *pos + len;
        *pos = end;
        Ok(hex::encode_upper(&src[start as usize..end as usize]).into())
    }
}

pub fn standard_types() -> CustomTypes<'static> {
    static BOOL: CustomBool = CustomBool;
    static STRING: CustomString = CustomString;
    static HEX: CustomHex = CustomHex;
    let mut result = CustomTypes::new();
    result.insert("bool".to_string(), &BOOL);
    result.insert("string".to_string(), &STRING);
    result.insert("hex".to_string(), &HEX);
    result
}

pub struct CompiledSchema<'a, 'b> {
    type_map: HashMap<*const AnyType, usize>,
    queue: Vec<(usize, &'a AnyType)>,
    types: Vec<CompiledType>,
    custom: &'b CustomTypes<'b>,
}

impl<'a, 'b> CompiledSchema<'a, 'b> {
    pub fn new(schema: &'a Schema, custom: &'b CustomTypes<'b>) -> Self {
        let mut result = CompiledSchema {
            type_map: HashMap::new(),
            queue: Vec::new(),
            types: Vec::new(),
            custom,
        };
        let mut custom_indexes = Vec::new();
        for (_, ty) in &schema.0 {
            result.add(schema, &mut custom_indexes, ty);
        }
        while !result.queue.is_empty() {
            for (id, ty) in std::mem::take(&mut result.queue) {
                result.complete(schema, &mut custom_indexes, id, ty);
            }
        }
        for idx in custom_indexes {
            result.resolve_custom(idx);
        }
        result
    }
    fn add(&mut self, schema: &'a Schema, custom: &mut Vec<usize>, ty: &'a AnyType) -> usize {
        let p: *const AnyType = &*ty;
        if let Some(id) = self.type_map.get(&p) {
            match &self.types[*id] {
                CompiledType::Alias(other) => {
                    return *other;
                }
                CompiledType::Uninitialized => {
                    panic!("Invalid recursion in types");
                }
                _ => {}
            }
            return *id;
        }
        let id = self.types.len();
        self.type_map.insert(p, id);
        self.types.push(CompiledType::Uninitialized);
        let mut result = id;
        self.types[id] = match ty {
            AnyType::Struct(members) => {
                let mut is_variable_size = false;
                let mut fixed_size = 0;
                let mut children = Vec::with_capacity(members.len());
                for (name, ty) in members {
                    let child = self.add(schema, custom, ty);
                    let childref = self.get_id(child);
                    if childref.is_variable_size() {
                        is_variable_size = true;
                    }
                    fixed_size += childref.fixed_size();
                    children.push((name.clone(), child))
                }
                CompiledType::Struct {
                    is_variable_size,
                    fixed_size,
                    children,
                }
            }
            AnyType::Array { type_, len } => {
                let child = self.add(schema, custom, type_);
                let childref = self.get_id(child);
                let len = u32::try_from(*len).unwrap();
                CompiledType::Array {
                    is_variable_size: childref.is_variable_size(),
                    fixed_size: childref.fixed_size().checked_mul(len).unwrap(),
                    child,
                    len,
                }
            }
            AnyType::Object(_)
            | AnyType::List(_)
            | AnyType::Option(_)
            | AnyType::Variant(..)
            | AnyType::Tuple(..)
            | AnyType::FracPack(..) => {
                self.queue.push((id, ty));
                CompiledType::Incomplete
            }
            AnyType::Int { bits, is_signed } => CompiledType::Int {
                bits: *bits,
                is_signed: *is_signed,
            },
            AnyType::Float { exp, mantissa } => CompiledType::Float {
                exp: *exp,
                mantissa: *mantissa,
            },
            AnyType::Custom { type_, id } => {
                let repr = self.add(schema, custom, type_);
                let ty = self.get_id(repr);
                if let Some(idx) = self.custom.find(&*id) {
                    custom.push(result);
                    CompiledType::Custom {
                        is_variable_size: ty.is_variable_size(),
                        fixed_size: ty.fixed_size(),
                        repr,
                        id: idx,
                    }
                } else {
                    result = repr;
                    CompiledType::Alias(repr)
                }
            }
            AnyType::Type(name) => {
                result = self.add(schema, custom, schema.0.get(name).unwrap());
                CompiledType::Alias(result)
            }
        };
        result
    }
    fn complete(
        &mut self,
        schema: &'a Schema,
        custom: &mut Vec<usize>,
        id: usize,
        ty: &'a AnyType,
    ) {
        let result = match ty {
            AnyType::Object(members) => {
                let mut children = Vec::with_capacity(members.len());
                for (name, ty) in members {
                    children.push((name.clone(), self.add(schema, custom, ty)))
                }
                CompiledType::Object { children }
            }
            AnyType::List(elem) => CompiledType::List(self.add(schema, custom, &*elem)),
            AnyType::Option(ty) => CompiledType::Option(self.add(schema, custom, &*ty)),
            AnyType::Variant(alternatives) => {
                let mut result = Vec::with_capacity(alternatives.len());
                for (name, ty) in alternatives {
                    result.push((name.clone(), self.add(schema, custom, ty)));
                }
                CompiledType::Variant(result)
            }
            AnyType::Tuple(members) => {
                let mut result = Vec::with_capacity(members.len());
                for ty in members {
                    result.push(self.add(schema, custom, ty))
                }
                CompiledType::Tuple(result)
            }
            AnyType::FracPack(nested) => CompiledType::FracPack(self.add(schema, custom, nested)),
            _ => {
                panic!("Not a recursive type");
            }
        };
        self.types[id] = result;
    }
    fn resolve_custom(&mut self, id: usize) {
        use CompiledType::*;
        let Custom {
            repr,
            id: custom_id,
            fixed_size,
            is_variable_size,
        } = &self.types[id]
        else {
            panic!("Not a custom type");
        };
        // If the next type is also a custom type unwrap it,
        // We never need to unwrap more than one level,
        // because we're calling this in bottom up order.
        let mut next = *repr;
        let ty = match &self.types[next] {
            Custom { repr, .. } | Alias(repr) => {
                next = *repr;
                &self.types[next]
            }
            ty => ty,
        };
        if self.custom.matches(*custom_id, self, ty) {
            self.types[id] = Custom {
                repr: next,
                id: *custom_id,
                fixed_size: *fixed_size,
                is_variable_size: *is_variable_size,
            };
        } else {
            self.types[id] = Alias(next);
        }
    }
    fn get_id(&self, id: usize) -> &CompiledType {
        &self.types[id]
    }
    pub fn get(&self, ty: &AnyType) -> Option<&CompiledType> {
        let p: *const AnyType = &*ty;
        if let Some(id) = self.type_map.get(&p) {
            let result = &self.types[*id];
            match result {
                CompiledType::Alias(other) => Some(self.get_id(*other)),
                _ => Some(result),
            }
        } else {
            None
        }
    }
}

#[derive(Debug)]
pub enum CompiledType {
    Struct {
        is_variable_size: bool,
        fixed_size: u32,
        children: Vec<(String, usize)>,
    },
    Object {
        children: Vec<(String, usize)>,
    },
    Array {
        is_variable_size: bool,
        fixed_size: u32,
        child: usize,
        len: u32,
    },
    List(usize),
    Option(usize),
    Variant(Vec<(String, usize)>),
    Tuple(Vec<usize>),
    Int {
        bits: u32,
        is_signed: bool,
    },
    Float {
        exp: u32,
        mantissa: u32,
    },
    FracPack(usize),
    Custom {
        is_variable_size: bool,
        fixed_size: u32,
        repr: usize,
        id: usize,
    },
    Alias(usize),
    Uninitialized,
    Incomplete, // The type is known to be variable size
}

impl CompiledType {
    fn is_variable_size(&self) -> bool {
        use CompiledType::*;
        match self {
            Struct {
                is_variable_size, ..
            } => *is_variable_size,
            Object { .. } => true,
            Array {
                is_variable_size, ..
            } => *is_variable_size,
            List(..) => true,
            Option(..) => true,
            Variant(..) => true,
            Tuple(..) => true,
            Int { .. } => false,
            Float { .. } => false,
            FracPack(..) => true,
            Custom {
                is_variable_size, ..
            } => *is_variable_size,
            Alias(..) => {
                panic!("Alias should be resolved");
            }
            Uninitialized => {
                panic!("Invalid recursion in types");
            }
            Incomplete => true,
        }
    }
    fn fixed_size(&self) -> u32 {
        use CompiledType::*;
        match self {
            Struct {
                fixed_size,
                is_variable_size: false,
                ..
            } => *fixed_size,
            Array {
                fixed_size,
                is_variable_size: false,
                ..
            } => *fixed_size,
            Int { bits, .. } => (bits + 7) / 8,
            Float { exp, mantissa } => (exp + mantissa + 7) / 8,
            Custom {
                fixed_size,
                is_variable_size: false,
                ..
            } => *fixed_size,
            Uninitialized => {
                panic!("Invalid recursion in types");
            }
            _ => 4,
        }
    }
    fn is_optional(&self) -> bool {
        match self {
            CompiledType::Option(..) => true,
            _ => false,
        }
    }
    fn new_empty_container(&self, schema: &CompiledSchema) -> Result<serde_json::Value, Error> {
        use CompiledType::*;
        match self {
            List(_) => Ok(serde_json::Value::Array(Vec::new())),
            FracPack(nested) => {
                let mut pos = 0;
                frac2json(schema, schema.get_id(*nested), &[0, 0, 0, 0], &mut pos)
            }
            Custom { repr, id, .. } => {
                let mut pos = 0;
                schema
                    .custom
                    .frac2json(*id, schema, schema.get_id(*repr), &[0, 0, 0, 0], &mut pos)
            }
            _ => Err(Error::BadOffset),
        }
    }
}

fn frac2json_pointer(
    schema: &CompiledSchema,
    ty: &CompiledType,
    src: &[u8],
    pos: u32,
    offset: u32,
    heap_pos: &mut u32,
) -> Result<serde_json::Value, Error> {
    if offset == 0 {
        return ty.new_empty_container(schema);
    }
    if *heap_pos as u64 != pos as u64 + offset as u64 {
        return Err(Error::BadOffset);
    }
    return frac2json(schema, ty, src, heap_pos);
}

fn frac2json_embedded(
    schema: &CompiledSchema,
    ty: &CompiledType,
    src: &[u8],
    fixed_pos: &mut u32,
    heap_pos: &mut u32,
) -> Result<serde_json::Value, Error> {
    match ty {
        CompiledType::Option(t) => {
            let orig_pos = *fixed_pos;
            let offset = u32::unpack(src, fixed_pos)?;
            if offset == 1 {
                return Ok(serde_json::Value::Null);
            }
            frac2json_pointer(schema, schema.get_id(*t), src, orig_pos, offset, heap_pos)
        }
        _ => {
            if ty.is_variable_size() {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                frac2json_pointer(schema, ty, src, orig_pos, offset, heap_pos)
            } else {
                frac2json(schema, ty, src, fixed_pos)
            }
        }
    }
}

pub fn frac2json(
    schema: &CompiledSchema,
    ty: &CompiledType,
    src: &[u8],
    pos: &mut u32,
) -> Result<serde_json::Value, Error> {
    use CompiledType::*;
    match ty {
        Struct {
            fixed_size,
            children,
            ..
        } => {
            let mut result = serde_json::Map::with_capacity(children.len());
            let mut fixed_pos = *pos;
            *pos += fixed_size;
            for (name, child) in children {
                result.insert(
                    name.clone(),
                    frac2json_embedded(schema, schema.get_id(*child), src, &mut fixed_pos, pos)?,
                );
            }
            Ok(serde_json::Value::Object(result))
        }
        Object { children, .. } => {
            let mut result = serde_json::Map::with_capacity(children.len());
            let fixed_size = u16::unpack(src, pos)? as u32;
            let mut fixed_pos = *pos;
            if src.len() - (fixed_pos as usize) < fixed_size as usize {
                return Err(Error::ReadPastEnd);
            }
            let fixed_end = fixed_pos + fixed_size as u32;
            *pos = fixed_end;
            let mut at_end = false;
            for (name, child) in children {
                let member_type = schema.get_id(*child);
                let remaining = fixed_end - fixed_pos;
                if remaining < member_type.fixed_size() {
                    at_end = true;
                }
                if at_end {
                    if remaining == 0 && member_type.is_optional() {
                        result.insert(name.clone(), serde_json::Value::Null);
                    } else {
                        return Err(Error::BadSize);
                    }
                } else {
                    result.insert(
                        name.clone(),
                        frac2json_embedded(schema, member_type, src, &mut fixed_pos, pos)?,
                    );
                }
            }
            Ok(serde_json::Value::Object(result))
        }
        Array { child, len, .. } => {
            let mut result = <Vec<serde_json::Value>>::with_capacity(*len as usize);
            let mut fixed_pos = *pos;
            let ty = schema.get_id(*child);
            let fixed_size = ty.fixed_size().checked_mul(*len).ok_or(Error::BadSize)?;
            if src.len() - (fixed_pos as usize) < fixed_size as usize {
                return Err(Error::ReadPastEnd);
            }
            *pos = fixed_pos + fixed_size;
            for _ in 0..*len {
                result.push(frac2json_embedded(schema, ty, src, &mut fixed_pos, pos)?);
            }
            Ok(result.into())
        }
        List(child) => {
            let fixed_size = u32::unpack(src, pos)?;
            let ty = schema.get_id(*child);
            let elem_size = ty.fixed_size();
            if fixed_size % elem_size != 0 {
                return Err(Error::BadSize);
            }
            let len = fixed_size / elem_size;
            let mut fixed_pos = *pos;
            let mut result = Vec::with_capacity(len as usize);
            if src.len() - (fixed_pos as usize) < fixed_size as usize {
                return Err(Error::ReadPastEnd);
            }
            *pos = fixed_pos + fixed_size;
            for _ in 0..len {
                result.push(frac2json_embedded(schema, ty, src, &mut fixed_pos, pos)?)
            }
            Ok(result.into())
        }
        Option(..) => {
            let mut fixed_pos = *pos;
            let fixed_size = 4;
            if src.len() - (fixed_pos as usize) < fixed_size as usize {
                return Err(Error::ReadPastEnd);
            }
            *pos = fixed_pos + fixed_size;
            frac2json_embedded(schema, ty, src, &mut fixed_pos, pos)
        }
        Variant(alternatives) => {
            let index = u8::unpack(src, pos)?;
            let len = u32::unpack(src, pos)?;
            if index as usize >= alternatives.len() {
                return Err(Error::BadEnumIndex);
            }
            if src.len() - (*pos as usize) < len as usize {
                return Err(Error::ReadPastEnd);
            }
            let (name, child) = &alternatives[index as usize];
            let ty = schema.get_id(*child);
            let mut result = serde_json::Map::with_capacity(1);
            result.insert(
                name.clone(),
                frac2json(schema, ty, &src[0..(*pos as usize + len as usize)], pos)?,
            );
            Ok(result.into())
        }
        Tuple(children) => {
            let mut result = Vec::with_capacity(children.len());
            let fixed_size = u16::unpack(src, pos)? as u32;
            let mut fixed_pos = *pos;
            if src.len() - (fixed_pos as usize) < fixed_size as usize {
                return Err(Error::ReadPastEnd);
            }
            let fixed_end = fixed_pos + fixed_size as u32;
            *pos = fixed_end;
            let mut at_end = false;
            for child in children {
                let member_type = schema.get_id(*child);
                let remaining = fixed_end - fixed_pos;
                if remaining < member_type.fixed_size() {
                    at_end = true;
                }
                if at_end {
                    if remaining == 0 && member_type.is_optional() {
                        result.push(serde_json::Value::Null);
                    } else {
                        return Err(Error::BadSize);
                    }
                } else {
                    result.push(frac2json_embedded(
                        schema,
                        member_type,
                        src,
                        &mut fixed_pos,
                        pos,
                    )?);
                }
            }
            Ok(result.into())
        }
        Int {
            bits: 1,
            is_signed: false,
        } => {
            let result = u8::unpack(src, pos)?;
            if result != 0 && result != 1 {
                Err(Error::BadScalar)?
            }
            Ok(result.into())
        }
        Int {
            bits: 1,
            is_signed: true,
        } => {
            let result = i8::unpack(src, pos)?;
            if result != 0 && result != -1 {
                Err(Error::BadScalar)?
            }
            Ok(result.into())
        }
        Int {
            bits: 8,
            is_signed: false,
        } => Ok(u8::unpack(src, pos)?.into()),
        Int {
            bits: 8,
            is_signed: true,
        } => Ok(i8::unpack(src, pos)?.into()),
        Int {
            bits: 16,
            is_signed: false,
        } => Ok(u16::unpack(src, pos)?.into()),
        Int {
            bits: 16,
            is_signed: true,
        } => Ok(i16::unpack(src, pos)?.into()),
        Int {
            bits: 32,
            is_signed: false,
        } => Ok(u32::unpack(src, pos)?.into()),
        Int {
            bits: 32,
            is_signed: true,
        } => Ok(i32::unpack(src, pos)?.into()),
        Int {
            bits: 64,
            is_signed: false,
        } => Ok(u64::unpack(src, pos)?.into()),
        Int {
            bits: 64,
            is_signed: true,
        } => Ok(i64::unpack(src, pos)?.into()),
        Float {
            exp: 8,
            mantissa: 24,
        } => {
            let result = f32::unpack(src, pos)?;
            if result.is_finite() {
                Ok(result.into())
            } else {
                Ok(result.to_string().into())
            }
        }
        Float {
            exp: 11,
            mantissa: 53,
        } => {
            let result = f64::unpack(src, pos)?;
            if result.is_finite() {
                Ok(result.into())
            } else {
                Ok(result.to_string().into())
            }
        }
        FracPack(nested) => {
            let len = u32::unpack(src, pos)?;
            if src.len() - (*pos as usize) < len as usize {
                return Err(Error::ReadPastEnd);
            }
            let ty = schema.get_id(*nested);
            let end = *pos + len;
            let result = frac2json(schema, ty, &src[0..end as usize], pos)?;
            // TODO: check pos
            Ok(result)
        }
        Custom { id, repr, .. } => {
            schema
                .custom
                .frac2json(*id, schema, schema.get_id(*repr), src, pos)
        }
        _ => {
            unimplemented!();
        }
    }
}

//pub fn json2frac(schema: &CompiledSchema, ty: &CompiledType, serde_json::Value, dest: &mut Vec<u8>) {
//    use CompiledType::*;
//}
