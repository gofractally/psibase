use crate::{consume_trailing_optional, Error, FracInputStream, Pack, Unpack};
use indexmap::IndexMap;
use serde::de::Error as _;
use serde::{Deserialize, Serialize};
use serde_aux::prelude::deserialize_number_from_string;
use std::any::TypeId;
use std::collections::{HashMap, HashSet};
use std::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Not};

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub use indexmap;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "crate")]
pub struct Schema(IndexMap<String, AnyType>);

impl Schema {
    pub fn get(&self, name: &str) -> Option<&AnyType> {
        self.0.get(name)
    }
}

impl IntoIterator for Schema {
    type Item = <IndexMap<String, AnyType> as IntoIterator>::Item;
    type IntoIter = <IndexMap<String, AnyType> as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a> IntoIterator for &'a Schema {
    type Item = <&'a IndexMap<String, AnyType> as IntoIterator>::Item;
    type IntoIter = <&'a IndexMap<String, AnyType> as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter {
        (&self.0).into_iter()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
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

impl<T: VisitTypes> VisitTypes for Vec<T> {
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
        src: &mut FracInputStream,
        allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error>;
    fn json2frac(
        &self,
        schema: &CompiledSchema,
        ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error>;
    fn is_empty_container(&self, ty: &CompiledType, value: &serde_json::Value) -> bool;
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
        src: &mut FracInputStream,
        allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error> {
        self.handlers[id].frac2json(schema, ty, src, allow_empty_container)
    }
    fn json2frac(
        &self,
        id: usize,
        schema: &CompiledSchema,
        ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        self.handlers[id].json2frac(schema, ty, val, dest)
    }
    fn is_empty_container(&self, id: usize, ty: &CompiledType, value: &serde_json::Value) -> bool {
        self.handlers[id].is_empty_container(ty, value)
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
        src: &mut FracInputStream,
        _allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error> {
        Ok(bool::unpack(src)?.into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(bool::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

struct CustomString;

impl CustomHandler for CustomString {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        use CompiledType::*;
        if let List(item) = ty {
            matches!(schema.get_by_id(*item), Int { bits: 8, .. })
        } else {
            false
        }
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &mut FracInputStream,
        allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error> {
        let result = String::unpack(src)?;
        if !allow_empty_container && result.is_empty() {
            Err(Error::PtrEmptyList)
        } else {
            Ok(result.into())
        }
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(<&str>::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, value: &serde_json::Value) -> bool {
        value.as_str().map_or(false, |s| s.is_empty())
    }
}

struct CustomHex;

impl CustomHandler for CustomHex {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        use CompiledType::*;
        if let List(item) = ty {
            !schema.get_by_id(*item).is_variable_size()
        } else {
            matches!(ty, FracPack(..)) || !ty.is_variable_size()
        }
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        ty: &CompiledType,
        src: &mut FracInputStream,
        allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error> {
        let len = if ty.is_variable_size() {
            u32::unpack(src)?
        } else {
            ty.fixed_size()
        };
        if !allow_empty_container && len == 0 && ty.is_variable_size() {
            return Err(Error::PtrEmptyList);
        }
        let start = src.advance(len)?;
        let end = src.pos;
        Ok(hex::encode_upper(&src.data[start as usize..end as usize]).into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        let s = val
            .as_str()
            .ok_or_else(|| serde_json::Error::custom("Expected hex string"))?;
        let x = hex::decode(s).map_err(|_| serde_json::Error::custom("Expected hex string"))?;
        if ty.is_variable_size() {
            Ok(x.pack(dest))
        } else {
            if ty.fixed_size() as usize != x.len() {
                return Err(serde_json::Error::custom(format!(
                    "Expected hex string of length {}",
                    ty.fixed_size()
                )));
            }
            dest.extend_from_slice(&x);
            Ok(())
        }
    }
    fn is_empty_container(&self, ty: &CompiledType, value: &serde_json::Value) -> bool {
        ty.is_variable_size() && value.as_str().map_or(false, |s| s.is_empty())
    }
}

struct CustomMap;

impl CustomHandler for CustomMap {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        use CompiledType::*;
        if let List(item) = ty {
            use CompiledType::*;
            match schema.get_by_id(*item) {
                Object { children, .. } | Struct { children, .. } => children.len() == 2,
                Tuple(children) => children.len() == 2,
                _ => false,
            }
        } else {
            false
        }
    }
    fn frac2json(
        &self,
        schema: &CompiledSchema,
        ty: &CompiledType,
        src: &mut FracInputStream,
        allow_empty_container: bool,
    ) -> Result<serde_json::Value, Error> {
        let mut result = frac2json_impl(schema, ty, src, allow_empty_container)?;
        use serde_json::{
            Map, Value,
            Value::{Array, Object},
        };
        let arr = result.as_array_mut().unwrap();
        let mut obj_result: Map<String, Value> = Map::with_capacity(arr.len());
        for item in arr {
            match std::mem::take(item) {
                Object(m) => {
                    assert!(m.len() == 2);
                    let mut iter = m.into_values();
                    let Value::String(k) = iter.next().unwrap() else {
                        return Err(Error::ExpectedStringKey);
                    };
                    let v = iter.next().unwrap();
                    obj_result.insert(k, v);
                }
                Array(v) => {
                    assert!(v.len() == 2);
                    let mut iter = v.into_iter();
                    let Value::String(k) = iter.next().unwrap() else {
                        return Err(Error::ExpectedStringKey);
                    };
                    let v = iter.next().unwrap();
                    obj_result.insert(k, v);
                }
                _ => panic!("Expected object or array"),
            }
        }
        Ok(Object(obj_result))
    }
    fn json2frac(
        &self,
        schema: &CompiledSchema,
        ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        // ty must be a list
        use CompiledType::*;
        let List(elemid) = ty else {
            panic!("Expected List type");
        };
        let elemty = schema.get_by_id(*elemid);
        let Some(map) = val.as_object() else {
            return Err(serde_json::Error::custom("Expected map"));
        };
        let mut tmp = Vec::with_capacity(map.len());
        match elemty {
            Struct { children, .. } | Object { children, .. } => {
                for (k, v) in map {
                    let mut item = serde_json::Map::with_capacity(2);
                    item.insert(children[0].0.clone(), serde_json::Value::String(k.clone()));
                    item.insert(children[1].0.clone(), v.clone());
                    tmp.push(serde_json::Value::Object(item))
                }
            }
            Tuple(..) => {
                for (k, v) in map {
                    tmp.push(serde_json::Value::Array(vec![
                        serde_json::Value::String(k.clone()),
                        v.clone(),
                    ]));
                }
            }
            _ => panic!("Expected Struct, Object, or Tuple"),
        }
        json2frac(schema, ty, &serde_json::Value::Array(tmp), dest)
    }
    fn is_empty_container(&self, _ty: &CompiledType, value: &serde_json::Value) -> bool {
        value.as_object().map_or(false, |s| s.is_empty())
    }
}

pub fn standard_types() -> CustomTypes<'static> {
    static BOOL: CustomBool = CustomBool;
    static STRING: CustomString = CustomString;
    static HEX: CustomHex = CustomHex;
    static MAP: CustomMap = CustomMap;
    let mut result = CustomTypes::new();
    result.insert("bool".to_string(), &BOOL);
    result.insert("string".to_string(), &STRING);
    result.insert("hex".to_string(), &HEX);
    result.insert("map".to_string(), &MAP);
    result
}

trait CompiledSchemaTypeId {
    fn to_compiled_type<'a>(&self, schema: &'a CompiledSchema) -> Option<&'a CompiledType>;
}

impl<T: std::hash::Hash + Eq + ?Sized> CompiledSchemaTypeId for T
where
    String: std::borrow::Borrow<T>,
{
    fn to_compiled_type<'a>(&self, schema: &'a CompiledSchema) -> Option<&'a CompiledType> {
        schema.get_by_name(self)
    }
}

impl CompiledSchemaTypeId for AnyType {
    fn to_compiled_type<'a>(&self, schema: &'a CompiledSchema) -> Option<&'a CompiledType> {
        schema.get_by_type(self)
    }
}

trait CompiledSchemaType {
    fn as_compiled_type<'a>(&'a self, schema: &'a CompiledSchema) -> Option<&'a CompiledType>;
}

impl<T: CompiledSchemaTypeId> CompiledSchemaType for T {
    fn as_compiled_type<'a>(&'a self, schema: &'a CompiledSchema) -> Option<&'a CompiledType> {
        self.to_compiled_type(schema)
    }
}

impl CompiledSchemaType for CompiledType {
    fn as_compiled_type<'a>(&'a self, _schema: &'a CompiledSchema) -> Option<&'a CompiledType> {
        Some(self)
    }
}

pub struct CompiledSchema<'a> {
    type_map: HashMap<*const AnyType, usize>,
    queue: Vec<(usize, &'a AnyType)>,
    schema: &'a Schema,
    types: Vec<CompiledType>,
    custom: &'a CustomTypes<'a>,
}

impl<'a> CompiledSchema<'a> {
    pub fn new(schema: &'a Schema, custom: &'a CustomTypes<'a>) -> Self {
        let mut result = CompiledSchema {
            type_map: HashMap::new(),
            queue: Vec::new(),
            schema,
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
    pub fn extend(&mut self, ty: &'a AnyType) {
        let mut custom_indexes = Vec::new();
        self.add(self.schema, &mut custom_indexes, ty);
        while !self.queue.is_empty() {
            for (id, ty) in std::mem::take(&mut self.queue) {
                self.complete(self.schema, &mut custom_indexes, id, ty);
            }
        }
        for idx in custom_indexes {
            self.resolve_custom(idx);
        }
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
                    let childref = self.get_by_id(child);
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
                let childref = self.get_by_id(child);
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
                let ty = self.get_by_id(repr);
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
    fn get_by_id(&self, id: usize) -> &CompiledType {
        match &self.types[id] {
            CompiledType::Alias(next) => &self.types[*next],
            ty => ty,
        }
    }

    /// Looks up a CompiledType
    ///
    /// The arguemnt can be either any borrowed form of String or an
    /// &AnyType that is part of the Schema.
    #[allow(private_bounds)]
    pub fn get<T: CompiledSchemaTypeId + ?Sized>(&'a self, ty: &T) -> Option<&'a CompiledType> {
        ty.to_compiled_type(self)
    }
    fn get_by_type(&self, ty: &AnyType) -> Option<&CompiledType> {
        let p: *const AnyType = &*ty;
        if let Some(id) = self.type_map.get(&p) {
            let result = &self.types[*id];
            match result {
                CompiledType::Alias(other) => Some(self.get_by_id(*other)),
                _ => Some(result),
            }
        } else {
            None
        }
    }
    fn get_by_name<T: std::hash::Hash + Eq + ?Sized>(&self, ty: &T) -> Option<&CompiledType>
    where
        String: std::borrow::Borrow<T>,
    {
        self.schema.0.get(ty).and_then(|ty| self.get_by_type(ty))
    }

    /// Converts packed data to a Value
    ///
    /// The type can be specified as any of a string,
    /// a &CompiledType, or an &AnyType.
    #[allow(private_bounds)]
    pub fn to_value<T: CompiledSchemaType + ?Sized>(
        &self,
        ty: &T,
        src: &[u8],
    ) -> Result<serde_json::Value, Error> {
        frac2json(
            self,
            ty.as_compiled_type(self)
                .ok_or_else(|| Error::UnknownType)?,
            src,
        )
    }
    /// Verifies that packed data is valid
    ///
    /// The type can be specified as any of a string,
    /// a &CompiledType, or an &AnyType.
    #[allow(private_bounds)]
    pub fn verify<T: CompiledSchemaType + ?Sized>(&self, ty: &T, src: &[u8]) -> Result<(), Error> {
        fracpack_verify(
            self,
            ty.as_compiled_type(self)
                .ok_or_else(|| Error::UnknownType)?,
            src,
        )
    }
    /// Verifies that packed data is valid and does not
    /// contain any unknown fields
    ///
    /// The type can be specified as any of a string,
    /// a &CompiledType, or an &AnyType.
    #[allow(private_bounds)]
    pub fn verify_strict<T: CompiledSchemaType + ?Sized>(
        &self,
        ty: &T,
        src: &[u8],
    ) -> Result<(), Error> {
        fracpack_verify_strict(
            self,
            ty.as_compiled_type(self)
                .ok_or_else(|| Error::UnknownType)?,
            src,
        )
    }
    /// Packs a Value
    ///
    /// The type can be specified as any of a string,
    /// a &CompiledType, or an &AnyType.
    #[allow(private_bounds)]
    pub fn from_value<T: CompiledSchemaType + ?Sized>(
        &self,
        ty: &T,
        val: &serde_json::Value,
    ) -> Result<Vec<u8>, serde_json::Error> {
        let mut result = Vec::new();
        json2frac(
            self,
            ty.as_compiled_type(self)
                .ok_or_else(|| serde_json::Error::custom("Unknown type"))?,
            val,
            &mut result,
        )?;
        Ok(result)
    }

    /// If ty is a fixed-size, single element struct, return its element type.
    /// Otherwise return ty.
    pub fn unwrap_struct(&'a self, ty: &'a CompiledType) -> &'a CompiledType {
        use CompiledType::*;
        match ty {
            Struct {
                is_variable_size: false,
                children,
                ..
            } if children.len() == 1 => self.get_by_id(children[0].1),
            _ => ty,
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
            FracPack(nested) => frac2json(schema, schema.get_by_id(*nested), &[]),
            Custom { repr, id, .. } => schema.custom.frac2json(
                *id,
                schema,
                schema.get_by_id(*repr),
                &mut FracInputStream::new(&[0, 0, 0, 0]),
                true,
            ),
            _ => Err(Error::BadOffset),
        }
    }
    fn is_empty_container(&self, schema: &CompiledSchema, val: &serde_json::Value) -> bool {
        use CompiledType::*;
        match self {
            List(_) => val.as_array().map_or(false, |a| a.is_empty()),
            FracPack(nested) => schema.get_by_id(*nested).fixed_size() == 0,
            Custom { repr, id, .. } => {
                schema
                    .custom
                    .is_empty_container(*id, schema.get_by_id(*repr), val)
            }
            _ => false,
        }
    }
}

fn frac2json_pointer(
    schema: &CompiledSchema,
    ty: &CompiledType,
    stream: &mut FracInputStream,
    fixed_pos: u32,
    offset: u32,
) -> Result<serde_json::Value, Error> {
    if offset == 0 {
        return ty.new_empty_container(schema);
    }
    let Some(new_pos) = fixed_pos.checked_add(offset) else {
        return Err(Error::ReadPastEnd);
    };
    stream.set_pos(new_pos)?;
    return frac2json_impl(schema, ty, stream, false);
}

fn frac2json_embedded(
    schema: &CompiledSchema,
    ty: &CompiledType,
    fixed_stream: &mut FracInputStream,
    stream: &mut FracInputStream,
    empty_optional: &mut bool,
) -> Result<serde_json::Value, Error> {
    *empty_optional = false;
    match ty {
        CompiledType::Option(t) => {
            let orig_pos = fixed_stream.pos;
            let offset = u32::unpack(fixed_stream)?;
            if offset == 1 {
                *empty_optional = true;
                return Ok(serde_json::Value::Null);
            }
            frac2json_pointer(schema, schema.get_by_id(*t), stream, orig_pos, offset)
        }
        _ => {
            if ty.is_variable_size() {
                let orig_pos = fixed_stream.pos;
                let offset = u32::unpack(fixed_stream)?;
                frac2json_pointer(schema, ty, stream, orig_pos, offset)
            } else {
                frac2json_impl(schema, ty, fixed_stream, true)
            }
        }
    }
}

fn frac2json(
    schema: &CompiledSchema,
    ty: &CompiledType,
    src: &[u8],
) -> Result<serde_json::Value, Error> {
    let mut stream = FracInputStream::new(src);
    let result = frac2json_impl(schema, ty, &mut stream, true)?;
    stream.finish()?;
    Ok(result)
}

fn frac2json_impl(
    schema: &CompiledSchema,
    ty: &CompiledType,
    stream: &mut FracInputStream,
    allow_empty_container: bool,
) -> Result<serde_json::Value, Error> {
    use CompiledType::*;
    match ty {
        Struct {
            fixed_size,
            children,
            ..
        } => {
            let mut result = serde_json::Map::with_capacity(children.len());
            let mut fixed_stream = stream.read_fixed(*fixed_size)?;
            let mut empty = false;
            for (name, child) in children {
                result.insert(
                    name.clone(),
                    frac2json_embedded(
                        schema,
                        schema.get_by_id(*child),
                        &mut fixed_stream,
                        stream,
                        &mut empty,
                    )?,
                );
            }
            Ok(serde_json::Value::Object(result))
        }
        Object { children, .. } => {
            let mut result = serde_json::Map::with_capacity(children.len());
            let fixed_size = u16::unpack(stream)? as u32;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut at_end = false;
            let mut last_empty = false;

            for (name, child) in children {
                let member_type = schema.get_by_id(*child);
                let remaining = fixed_stream.remaining();
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
                        frac2json_embedded(
                            schema,
                            member_type,
                            &mut fixed_stream,
                            stream,
                            &mut last_empty,
                        )?,
                    );
                }
            }
            consume_trailing_optional(&mut fixed_stream, stream, last_empty)?;
            Ok(serde_json::Value::Object(result))
        }
        Array { child, len, .. } => {
            let mut result = <Vec<serde_json::Value>>::with_capacity(*len as usize);
            let ty = schema.get_by_id(*child);
            let fixed_size = ty.fixed_size().checked_mul(*len).ok_or(Error::BadSize)?;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut last_empty = false;
            for _ in 0..*len {
                result.push(frac2json_embedded(
                    schema,
                    ty,
                    &mut fixed_stream,
                    stream,
                    &mut last_empty,
                )?);
            }
            Ok(result.into())
        }
        List(child) => {
            let fixed_size = u32::unpack(stream)?;
            if fixed_size == 0 && !allow_empty_container {
                return Err(Error::PtrEmptyList);
            }
            let ty = schema.get_by_id(*child);
            let elem_size = ty.fixed_size();
            if fixed_size % elem_size != 0 {
                return Err(Error::BadSize);
            }
            let len = fixed_size / elem_size;
            let mut result = Vec::with_capacity(len as usize);
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut last_empty = false;
            for _ in 0..len {
                result.push(frac2json_embedded(
                    schema,
                    ty,
                    &mut fixed_stream,
                    stream,
                    &mut last_empty,
                )?)
            }
            Ok(result.into())
        }
        Option(..) => {
            let mut fixed_stream = stream.read_fixed(4)?;
            let mut last_empty = false;
            frac2json_embedded(schema, ty, &mut fixed_stream, stream, &mut last_empty)
        }
        Variant(alternatives) => {
            let index = u8::unpack(stream)?;
            let len = u32::unpack(stream)?;
            if index as usize >= alternatives.len() {
                return Err(Error::BadEnumIndex);
            }
            let mut substream = stream.read_fixed(len)?;
            let (name, child) = &alternatives[index as usize];
            let ty = schema.get_by_id(*child);
            let untagged = frac2json_impl(schema, ty, &mut substream, true)?;
            if name.starts_with("@") {
                return Ok(untagged);
            }
            let mut result = serde_json::Map::with_capacity(1);
            result.insert(name.clone(), untagged);
            stream.has_unknown |= substream.has_unknown;
            substream.finish()?;
            Ok(result.into())
        }
        Tuple(children) => {
            let mut result = Vec::with_capacity(children.len());
            let fixed_size = u16::unpack(stream)? as u32;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut at_end = false;
            let mut last_empty = false;
            for child in children {
                let member_type = schema.get_by_id(*child);
                let remaining = fixed_stream.remaining();
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
                        &mut fixed_stream,
                        stream,
                        &mut last_empty,
                    )?);
                }
            }
            consume_trailing_optional(&mut fixed_stream, stream, last_empty)?;
            Ok(result.into())
        }
        Int {
            bits: 1,
            is_signed: false,
        } => {
            let result = u8::unpack(stream)?;
            if result != 0 && result != 1 {
                Err(Error::BadScalar)?
            }
            Ok(result.into())
        }
        Int {
            bits: 1,
            is_signed: true,
        } => {
            let result = i8::unpack(stream)?;
            if result != 0 && result != -1 {
                Err(Error::BadScalar)?
            }
            Ok(result.into())
        }
        Int {
            bits: 8,
            is_signed: false,
        } => Ok(u8::unpack(stream)?.into()),
        Int {
            bits: 8,
            is_signed: true,
        } => Ok(i8::unpack(stream)?.into()),
        Int {
            bits: 16,
            is_signed: false,
        } => Ok(u16::unpack(stream)?.into()),
        Int {
            bits: 16,
            is_signed: true,
        } => Ok(i16::unpack(stream)?.into()),
        Int {
            bits: 32,
            is_signed: false,
        } => Ok(u32::unpack(stream)?.into()),
        Int {
            bits: 32,
            is_signed: true,
        } => Ok(i32::unpack(stream)?.into()),
        Int {
            bits: 64,
            is_signed: false,
        } => Ok(u64::unpack(stream)?.into()),
        Int {
            bits: 64,
            is_signed: true,
        } => Ok(i64::unpack(stream)?.into()),
        Float {
            exp: 8,
            mantissa: 24,
        } => {
            let result = f32::unpack(stream)?;
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
            let result = f64::unpack(stream)?;
            if result.is_finite() {
                Ok(result.into())
            } else {
                Ok(result.to_string().into())
            }
        }
        FracPack(nested) => {
            let len = u32::unpack(stream)?;
            if len == 0 && !allow_empty_container {
                return Err(Error::PtrEmptyList);
            }
            let mut substream = stream.read_fixed(len)?;
            let ty = schema.get_by_id(*nested);
            let result = frac2json_impl(schema, ty, &mut substream, true)?;
            stream.has_unknown |= substream.has_unknown;
            substream.finish()?;
            Ok(result)
        }
        Custom { id, repr, .. } => {
            let repr = schema.get_by_id(*repr);
            // Use the underlying type for verification
            //fracpack_verify_impl(schema, repr, stream, allow_empty_container)?;
            schema
                .custom
                .frac2json(*id, schema, repr, stream, allow_empty_container)
        }
        _ => {
            unimplemented!();
        }
    }
}

#[derive(Debug)]
struct Repack<'a> {
    ty: &'a CompiledType,
    val: &'a serde_json::Value,
    fixed_pos: usize,
}

enum EmbeddedPack<'a> {
    Offset {
        ty: &'a CompiledType,
        val: &'a serde_json::Value,
    },
    NoHeap {
        schema: &'a CompiledSchema<'a>,
        ty: &'a CompiledType,
        val: &'a serde_json::Value,
    },
    EmptyOption,
}

impl<'a> EmbeddedPack<'a> {
    fn pack(self, dest: &mut Vec<u8>) -> Result<Option<Repack<'a>>, serde_json::Error> {
        use EmbeddedPack::*;
        match self {
            Offset { ty, val } => {
                let fixed_pos = dest.len();
                dest.extend_from_slice(&0u32.to_le_bytes());
                Ok(Some(Repack { ty, val, fixed_pos }))
            }
            NoHeap { schema, ty, val } => {
                json2frac(schema, ty, val, dest)?;
                Ok(None)
            }
            EmptyOption => {
                dest.extend_from_slice(&1u32.to_le_bytes());
                Ok(None)
            }
        }
    }
}

fn json2frac_pointer<'a>(
    schema: &'a CompiledSchema,
    ty: &'a CompiledType,
    val: &'a serde_json::Value,
) -> Result<EmbeddedPack<'a>, serde_json::Error> {
    if ty.is_empty_container(schema, val) {
        Ok(EmbeddedPack::NoHeap { schema, ty, val })
    } else {
        Ok(EmbeddedPack::Offset { ty, val })
    }
}

fn json2frac_fixed<'a>(
    schema: &'a CompiledSchema<'a>,
    ty: &'a CompiledType,
    val: Option<&'a serde_json::Value>,
) -> Result<EmbeddedPack<'a>, serde_json::Error> {
    match ty {
        CompiledType::Option(ty) => {
            if let Some(val) = val {
                if !val.is_null() {
                    return json2frac_pointer(schema, schema.get_by_id(*ty), val);
                }
            }
            Ok(EmbeddedPack::EmptyOption)
        }
        _ => {
            let Some(val) = val else {
                return Err(serde_json::Error::custom("Missing field"));
            };
            if ty.is_variable_size() {
                json2frac_pointer(schema, ty, val)
            } else {
                Ok(EmbeddedPack::NoHeap { schema, ty, val })
            }
        }
    }
}

fn json2frac_variable(
    schema: &CompiledSchema,
    info: Option<Repack>,
    dest: &mut Vec<u8>,
) -> Result<(), serde_json::Error> {
    if let Some(Repack { ty, val, fixed_pos }) = info {
        let heap_pos = dest.len();
        dest[fixed_pos..fixed_pos + 4]
            .copy_from_slice(&((heap_pos - fixed_pos) as u32).to_le_bytes());
        json2frac(schema, ty, val, dest)
    } else {
        Ok(())
    }
}

// Elides empty trailing optionals
struct ObjectWriter<'a> {
    items: Vec<Option<Repack<'a>>>,
    empty_count: u32,
}

impl<'a> ObjectWriter<'a> {
    fn with_capacity(capacity: usize) -> Self {
        ObjectWriter {
            items: Vec::with_capacity(capacity),
            empty_count: 0,
        }
    }
    fn push(
        &mut self,
        item: EmbeddedPack<'a>,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        if matches!(&item, EmbeddedPack::EmptyOption) {
            self.empty_count += 1;
        } else {
            for _i in 0..self.empty_count {
                self.items.push(EmbeddedPack::EmptyOption.pack(dest)?);
            }
            self.empty_count = 0;
            self.items.push(item.pack(dest)?)
        }
        Ok(())
    }
}

fn json2frac_untagged(
    schema: &CompiledSchema,
    alternatives: &Vec<(String, usize)>,
    val: &serde_json::Value,
    dest: &mut Vec<u8>,
) -> Option<()> {
    let alt_pos = dest.len();
    0u8.pack(dest);
    let size_pos = dest.len();
    0u32.pack(dest);
    let alt = alternatives.iter().position(|(name, id)| {
        if name.starts_with("@") {
            dest.truncate(alt_pos + 5);
            json2frac(schema, schema.get_by_id(*id), val, dest).is_ok()
        } else {
            false
        }
    })?;
    let end_pos = dest.len();
    let size = (end_pos - size_pos - 4) as u32;
    dest[alt_pos] = alt as u8;
    dest[size_pos..size_pos + 4].copy_from_slice(&size.to_le_bytes());
    Some(())
}

fn json2frac(
    schema: &CompiledSchema,
    ty: &CompiledType,
    val: &serde_json::Value,
    dest: &mut Vec<u8>,
) -> Result<(), serde_json::Error> {
    use CompiledType::*;
    match ty {
        Struct { children, .. } => {
            let Some(map) = val.as_object() else {
                return Err(serde_json::Error::custom("Expected object"));
            };
            let mut items = Vec::with_capacity(children.len());
            for (name, child) in children {
                items.push(
                    json2frac_fixed(schema, schema.get_by_id(*child), map.get(name))?.pack(dest)?,
                );
            }
            for item in items {
                json2frac_variable(schema, item, dest)?;
            }
            Ok(())
        }
        Object { children, .. } => {
            let Some(map) = val.as_object() else {
                return Err(serde_json::Error::custom("Expected object"));
            };
            let start_pos = dest.len();
            0u16.pack(dest);
            let mut items = ObjectWriter::with_capacity(children.len());
            for (name, child) in children {
                items.push(
                    json2frac_fixed(schema, schema.get_by_id(*child), map.get(name))?,
                    dest,
                )?;
            }
            let fixed_size = (dest.len() - (start_pos + 2)) as u16;
            dest[start_pos..start_pos + 2].copy_from_slice(&fixed_size.to_le_bytes());
            for item in items.items {
                json2frac_variable(schema, item, dest)?;
            }
            Ok(())
        }
        Array { child, len, .. } => {
            let arr = val
                .as_array()
                .ok_or_else(|| serde_json::Error::custom("Expected array"))?;
            let ty = schema.get_by_id(*child);
            if arr.len() != *len as usize {
                return Err(serde_json::Error::custom(format!(
                    "Expected array of length {}",
                    len
                )));
            }
            let mut items = Vec::with_capacity(arr.len());
            for item in arr {
                items.push(json2frac_fixed(schema, ty, Some(item))?.pack(dest)?);
            }
            for item in items {
                json2frac_variable(schema, item, dest)?;
            }
            Ok(())
        }
        List(ty) => {
            let arr = val
                .as_array()
                .ok_or_else(|| serde_json::Error::custom("Expected list"))?;
            let ty = schema.get_by_id(*ty);
            let len = (arr.len() as u32)
                .checked_mul(ty.fixed_size())
                .ok_or_else(|| serde_json::Error::custom("Packed data too large"))?;
            len.pack(dest);
            let mut items = Vec::with_capacity(arr.len());
            for item in arr {
                items.push(json2frac_fixed(schema, ty, Some(item))?.pack(dest)?);
            }
            for item in items {
                json2frac_variable(schema, item, dest)?;
            }
            Ok(())
        }
        Option(_) => {
            let item = json2frac_fixed(schema, ty, Some(val))?.pack(dest)?;
            json2frac_variable(schema, item, dest)
        }
        Variant(alternatives) => {
            let Some((alt, val)) =
                val.as_object()
                    .and_then(|m| if m.len() == 1 { m.iter().next() } else { None })
            else {
                return json2frac_untagged(schema, alternatives, val, dest)
                    .ok_or_else(|| serde_json::Error::custom("Expected variant"));
            };

            let Some(alt) = alternatives.iter().position(|(name, _)| name == alt) else {
                return json2frac_untagged(schema, alternatives, val, dest)
                    .ok_or_else(|| serde_json::Error::custom("Unknown variant alternative"));
            };
            (alt as u8).pack(dest);
            let size_pos = dest.len();
            0u32.pack(dest);
            json2frac(schema, schema.get_by_id(alternatives[alt].1), val, dest)?;
            let end_pos = dest.len();
            let size = (end_pos - size_pos - 4) as u32;
            dest[size_pos..size_pos + 4].copy_from_slice(&size.to_le_bytes());
            Ok(())
        }
        Tuple(children) => {
            let Some(arr) = val.as_array() else {
                return Err(serde_json::Error::custom("Expected tuple"));
            };
            if arr.len() != children.len() {
                return Err(serde_json::Error::custom(format!(
                    "Expected tuple of length {}",
                    children.len()
                )));
            }
            let start_pos = dest.len();
            0u16.pack(dest);
            let mut items = ObjectWriter::with_capacity(children.len());
            for (ty, val) in children.iter().zip(arr) {
                items.push(
                    json2frac_fixed(schema, schema.get_by_id(*ty), Some(val))?,
                    dest,
                )?;
            }
            let fixed_size = (dest.len() - (start_pos + 2)) as u16;
            dest[start_pos..start_pos + 2].copy_from_slice(&fixed_size.to_le_bytes());
            for item in items.items {
                json2frac_variable(schema, item, dest)?;
            }
            Ok(())
        }
        Int {
            bits: 1,
            is_signed: false,
        } => {
            let v = u8::deserialize(val)?;
            if v == 0 || v == 1 {
                Ok(v.pack(dest))
            } else {
                Err(serde_json::Error::custom("Out-of-range"))
            }
        }
        Int {
            bits: 1,
            is_signed: true,
        } => {
            let v = i8::deserialize(val)?;
            if v == 0 || v == -1 {
                Ok(v.pack(dest))
            } else {
                Err(serde_json::Error::custom("Out-of-range"))
            }
        }
        Int {
            bits: 8,
            is_signed: false,
        } => Ok(u8::deserialize(val)?.pack(dest)),
        Int {
            bits: 8,
            is_signed: true,
        } => Ok(i8::deserialize(val)?.pack(dest)),
        Int {
            bits: 16,
            is_signed: false,
        } => Ok(u16::deserialize(val)?.pack(dest)),
        Int {
            bits: 16,
            is_signed: true,
        } => Ok(i16::deserialize(val)?.pack(dest)),
        Int {
            bits: 32,
            is_signed: false,
        } => Ok(u32::deserialize(val)?.pack(dest)),
        Int {
            bits: 32,
            is_signed: true,
        } => Ok(i32::deserialize(val)?.pack(dest)),
        Int {
            bits: 64,
            is_signed: false,
        } => {
            let v: u64 = deserialize_number_from_string(val)?;
            Ok(v.pack(dest))
        }
        Int {
            bits: 64,
            is_signed: true,
        } => {
            let v: i64 = deserialize_number_from_string(val)?;
            Ok(v.pack(dest))
        }
        Float {
            exp: 8,
            mantissa: 24,
        } => {
            let v: f32 = deserialize_number_from_string(val)?;
            Ok(v.pack(dest))
        }
        Float {
            exp: 11,
            mantissa: 53,
        } => {
            let v: f64 = deserialize_number_from_string(val)?;
            Ok(v.pack(dest))
        }
        FracPack(nested) => {
            let start_pos = dest.len();
            0u32.pack(dest);
            json2frac(schema, schema.get_by_id(*nested), val, dest)?;
            let end_pos = dest.len();
            let size = (end_pos - start_pos - 4) as u32;
            dest[start_pos..start_pos + 4].copy_from_slice(&size.to_le_bytes());
            Ok(())
        }
        Custom { id, repr, .. } => {
            let repr = schema.get_by_id(*repr);
            schema.custom.json2frac(*id, schema, repr, val, dest)
        }

        _ => unimplemented!("{:?}", ty),
    }
}

fn fracpack_verify_pointer(
    schema: &CompiledSchema,
    ty: &CompiledType,
    stream: &mut FracInputStream,
    fixed_pos: u32,
    offset: u32,
) -> Result<(), Error> {
    if offset == 0 {
        ty.new_empty_container(schema)?;
        return Ok(());
    }
    let Some(new_pos) = fixed_pos.checked_add(offset) else {
        return Err(Error::ReadPastEnd);
    };
    stream.set_pos(new_pos)?;
    fracpack_verify_impl(schema, ty, stream, false)
}

fn fracpack_verify_embedded(
    schema: &CompiledSchema,
    ty: &CompiledType,
    fixed_stream: &mut FracInputStream,
    stream: &mut FracInputStream,
    empty_optional: &mut bool,
) -> Result<(), Error> {
    *empty_optional = false;
    match ty {
        CompiledType::Option(t) => {
            let orig_pos = fixed_stream.pos;
            let offset = u32::unpack(fixed_stream)?;
            if offset == 1 {
                *empty_optional = true;
                return Ok(());
            }
            fracpack_verify_pointer(schema, schema.get_by_id(*t), stream, orig_pos, offset)
        }
        _ => {
            if ty.is_variable_size() {
                let orig_pos = fixed_stream.pos;
                let offset = u32::unpack(fixed_stream)?;
                fracpack_verify_pointer(schema, ty, stream, orig_pos, offset)
            } else {
                fracpack_verify_impl(schema, ty, fixed_stream, true)
            }
        }
    }
}

fn fracpack_verify_impl(
    schema: &CompiledSchema,
    ty: &CompiledType,
    stream: &mut FracInputStream,
    allow_empty_container: bool,
) -> Result<(), Error> {
    use CompiledType::*;
    match ty {
        Struct {
            fixed_size,
            children,
            ..
        } => {
            let mut fixed_stream = stream.read_fixed(*fixed_size)?;
            let mut empty = false;
            for (_name, child) in children {
                fracpack_verify_embedded(
                    schema,
                    schema.get_by_id(*child),
                    &mut fixed_stream,
                    stream,
                    &mut empty,
                )?;
            }
        }
        Object { children, .. } => {
            let fixed_size = u16::unpack(stream)? as u32;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut at_end = false;
            let mut last_empty = false;

            for (_name, child) in children {
                let member_type = schema.get_by_id(*child);
                let remaining = fixed_stream.remaining();
                if remaining < member_type.fixed_size() {
                    at_end = true;
                }
                if at_end {
                    if remaining != 0 || !member_type.is_optional() {
                        return Err(Error::BadSize);
                    }
                } else {
                    fracpack_verify_embedded(
                        schema,
                        member_type,
                        &mut fixed_stream,
                        stream,
                        &mut last_empty,
                    )?;
                }
            }
            consume_trailing_optional(&mut fixed_stream, stream, last_empty)?;
        }
        Array { child, len, .. } => {
            let ty = schema.get_by_id(*child);
            let fixed_size = ty.fixed_size().checked_mul(*len).ok_or(Error::BadSize)?;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut last_empty = false;
            for _ in 0..*len {
                fracpack_verify_embedded(schema, ty, &mut fixed_stream, stream, &mut last_empty)?;
            }
        }
        List(child) => {
            let fixed_size = u32::unpack(stream)?;
            if fixed_size == 0 && !allow_empty_container {
                return Err(Error::PtrEmptyList);
            }
            let ty = schema.get_by_id(*child);
            let elem_size = ty.fixed_size();
            if fixed_size % elem_size != 0 {
                return Err(Error::BadSize);
            }
            let len = fixed_size / elem_size;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut last_empty = false;
            for _ in 0..len {
                fracpack_verify_embedded(schema, ty, &mut fixed_stream, stream, &mut last_empty)?;
            }
        }
        Option(..) => {
            let mut fixed_stream = stream.read_fixed(4)?;
            let mut last_empty = false;
            fracpack_verify_embedded(schema, ty, &mut fixed_stream, stream, &mut last_empty)?
        }
        Variant(alternatives) => {
            let index = u8::unpack(stream)?;
            let len = u32::unpack(stream)?;
            if index as usize >= alternatives.len() {
                return Err(Error::BadEnumIndex);
            }
            let mut substream = stream.read_fixed(len)?;
            let (_name, child) = &alternatives[index as usize];
            let ty = schema.get_by_id(*child);
            fracpack_verify_impl(schema, ty, &mut substream, true)?;
            stream.has_unknown |= substream.has_unknown;
            substream.finish()?;
        }
        Tuple(children) => {
            let fixed_size = u16::unpack(stream)? as u32;
            let mut fixed_stream = stream.read_fixed(fixed_size)?;
            let mut at_end = false;
            let mut last_empty = false;
            for child in children {
                let member_type = schema.get_by_id(*child);
                let remaining = fixed_stream.remaining();
                if remaining < member_type.fixed_size() {
                    at_end = true;
                }
                if at_end {
                    if remaining != 0 || !member_type.is_optional() {
                        return Err(Error::BadSize);
                    }
                } else {
                    fracpack_verify_embedded(
                        schema,
                        member_type,
                        &mut fixed_stream,
                        stream,
                        &mut last_empty,
                    )?;
                }
            }
            consume_trailing_optional(&mut fixed_stream, stream, last_empty)?;
        }
        Int {
            bits: 1,
            is_signed: false,
        } => {
            let result = u8::unpack(stream)?;
            if result != 0 && result != 1 {
                Err(Error::BadScalar)?
            }
        }
        Int {
            bits: 1,
            is_signed: true,
        } => {
            let result = i8::unpack(stream)?;
            if result != 0 && result != -1 {
                Err(Error::BadScalar)?
            }
        }
        Int {
            bits: 8,
            is_signed: false,
        } => u8::verify(stream)?,
        Int {
            bits: 8,
            is_signed: true,
        } => i8::verify(stream)?,
        Int {
            bits: 16,
            is_signed: false,
        } => u16::verify(stream)?,
        Int {
            bits: 16,
            is_signed: true,
        } => i16::verify(stream)?,
        Int {
            bits: 32,
            is_signed: false,
        } => u32::verify(stream)?,
        Int {
            bits: 32,
            is_signed: true,
        } => i32::verify(stream)?,
        Int {
            bits: 64,
            is_signed: false,
        } => u64::verify(stream)?,
        Int {
            bits: 64,
            is_signed: true,
        } => i64::verify(stream)?,
        Float {
            exp: 8,
            mantissa: 24,
        } => f32::verify(stream)?,
        Float {
            exp: 11,
            mantissa: 53,
        } => f64::verify(stream)?,
        FracPack(nested) => {
            let len = u32::unpack(stream)?;
            if len == 0 && !allow_empty_container {
                return Err(Error::PtrEmptyList);
            }
            let mut substream = stream.read_fixed(len)?;
            let ty = schema.get_by_id(*nested);
            fracpack_verify_impl(schema, ty, &mut substream, true)?;
            stream.has_unknown |= substream.has_unknown;
            substream.finish()?;
        }
        Custom { repr, .. } => {
            let repr = schema.get_by_id(*repr);
            fracpack_verify_impl(schema, repr, stream, allow_empty_container)?;
        }
        _ => {
            unimplemented!();
        }
    }
    Ok(())
}

fn fracpack_verify(schema: &CompiledSchema, ty: &CompiledType, src: &[u8]) -> Result<(), Error> {
    let mut stream = FracInputStream::new(src);
    fracpack_verify_impl(schema, ty, &mut stream, true)?;
    stream.finish()?;
    Ok(())
}

fn fracpack_verify_strict(
    schema: &CompiledSchema,
    ty: &CompiledType,
    src: &[u8],
) -> Result<(), Error> {
    let mut stream = FracInputStream::new(src);
    fracpack_verify_impl(schema, ty, &mut stream, true)?;
    stream.finish()?;
    if stream.has_unknown {
        Err(Error::HasUnknown)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaDifference(u8);

impl SchemaDifference {
    pub const EQUIVALENT: SchemaDifference = SchemaDifference(0);
    pub const INCOMPATIBLE: SchemaDifference = SchemaDifference(1);
    pub const ADD_FIELD: SchemaDifference = SchemaDifference(2);
    pub const DROP_FIELD: SchemaDifference = SchemaDifference(4);
    pub const ADD_ALTERNATIVE: SchemaDifference = SchemaDifference(8);
    pub const DROP_ALTERNATIVE: SchemaDifference = SchemaDifference(16);
}

impl SchemaDifference {
    fn includes(self, other: SchemaDifference) -> bool {
        (self | other) == self
    }
}

impl Not for SchemaDifference {
    type Output = SchemaDifference;
    fn not(self) -> SchemaDifference {
        SchemaDifference(!self.0)
    }
}

impl BitOr for SchemaDifference {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl BitOrAssign for SchemaDifference {
    fn bitor_assign(&mut self, rhs: Self) {
        *self = *self | rhs
    }
}

impl BitAnd for SchemaDifference {
    type Output = Self;
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl BitAndAssign for SchemaDifference {
    fn bitand_assign(&mut self, rhs: Self) {
        *self = *self & rhs
    }
}

pub struct SchemaMatcher<'a> {
    schema1: &'a Schema,
    schema2: &'a Schema,
    on_stack: HashMap<*const AnyType, usize>,
    known: HashSet<(*const AnyType, *const AnyType)>,
    allowed_difference: SchemaDifference,
}

impl<'a> SchemaMatcher<'a> {
    pub fn new(
        schema1: &'a Schema,
        schema2: &'a Schema,
        allowed_difference: SchemaDifference,
    ) -> Self {
        Self {
            schema1,
            schema2,
            on_stack: HashMap::new(),
            known: HashSet::new(),
            allowed_difference,
        }
    }
    fn resolve_all<'b>(schema: &'b Schema, mut ty: &'b AnyType) -> &'b AnyType {
        loop {
            use AnyType::*;
            match ty {
                Custom { type_, .. } => ty = type_,
                Type(name) => ty = schema.get(name).unwrap(),
                _ => return ty,
            }
        }
    }
    fn is_optional(schema: &Schema, ty: &AnyType) -> bool {
        matches!(Self::resolve_all(schema, ty), AnyType::Option(..))
    }
    fn compare_tuples<'b, I1: Iterator<Item = &'b AnyType>, I2: Iterator<Item = &'b AnyType>>(
        &mut self,
        mut liter: I1,
        mut riter: I2,
    ) -> bool {
        loop {
            match (liter.next(), riter.next()) {
                (Some(l), Some(r)) => {
                    if !self.compare(l, r) {
                        break false;
                    }
                }
                (Some(l), None) => {
                    if !Self::is_optional(self.schema1, l)
                        || liter.any(|l| !Self::is_optional(self.schema1, l))
                    {
                        break false;
                    }
                    break self
                        .allowed_difference
                        .includes(SchemaDifference::DROP_FIELD);
                }
                (None, Some(r)) => {
                    if !Self::is_optional(self.schema2, r)
                        || liter.any(|r| !Self::is_optional(self.schema2, r))
                    {
                        break false;
                    }
                    break self
                        .allowed_difference
                        .includes(SchemaDifference::ADD_FIELD);
                }
                (None, None) => break true,
            }
        }
    }
    pub fn compare(&mut self, lhs: &AnyType, rhs: &AnyType) -> bool {
        let plhs = Self::resolve_all(self.schema1, lhs);
        let prhs = Self::resolve_all(self.schema2, rhs);
        let lhs_pos = self.on_stack.get(&(plhs as *const AnyType));
        let rhs_pos = self.on_stack.get(&(prhs as *const AnyType));
        if lhs_pos != rhs_pos {
            return false;
        }

        if !self.known.insert((&*plhs, &*prhs)) {
            return true;
        }

        let n = self.on_stack.len() / 2;
        self.on_stack.insert(&*lhs, n);
        self.on_stack.insert(&*rhs, n);

        use AnyType::*;
        let result = match (plhs, prhs) {
            (Tuple(lmembers), Tuple(rmembers)) => {
                self.compare_tuples(lmembers.iter(), rmembers.iter())
            }
            (Object(lmembers), Object(rmembers)) => {
                self.compare_tuples(lmembers.values(), rmembers.values())
            }
            (Tuple(lmembers), Object(rmembers)) => {
                self.compare_tuples(lmembers.iter(), rmembers.values())
            }
            (Object(lmembers), Tuple(rmembers)) => {
                self.compare_tuples(lmembers.values(), rmembers.iter())
            }
            (Struct(lmembers), Struct(rmembers)) => {
                let mut liter = lmembers.values();
                let mut riter = rmembers.values();
                loop {
                    match (liter.next(), riter.next()) {
                        (Some(l), Some(r)) => {
                            if !self.compare(l, r) {
                                break false;
                            }
                        }
                        (None, None) => break true,
                        _ => break false,
                    }
                }
            }
            (
                Array {
                    len: llen,
                    type_: ltype,
                },
                Array {
                    len: rlen,
                    type_: rtype,
                },
            ) => llen == rlen && self.compare(ltype, rtype),
            (List(litem), List(ritem)) => self.compare(litem, ritem),
            (Option(litem), Option(ritem)) => self.compare(litem, ritem),
            (Variant(lalternatives), Variant(ralternatives)) => {
                let mut liter = lalternatives.values();
                let mut riter = ralternatives.values();
                loop {
                    match (liter.next(), riter.next()) {
                        (Some(l), Some(r)) => {
                            if !self.compare(l, r) {
                                break false;
                            }
                        }
                        (Some(..), None) => {
                            break self
                                .allowed_difference
                                .includes(SchemaDifference::DROP_ALTERNATIVE);
                        }
                        (None, Some(..)) => {
                            break self
                                .allowed_difference
                                .includes(SchemaDifference::ADD_ALTERNATIVE);
                        }
                        (None, None) => break true,
                    }
                }
            }
            (
                Float {
                    exp: lexp,
                    mantissa: lmantissa,
                },
                Float {
                    exp: rexp,
                    mantissa: rmantissa,
                },
            ) => lexp == rexp && lmantissa == rmantissa,
            (
                Int {
                    bits: lbits,
                    is_signed: lsign,
                },
                Int {
                    bits: rbits,
                    is_signed: rsign,
                },
            ) => {
                // HACK: C++ uses char (which may be signed) as a byte type
                lbits == rbits && (lsign == rsign || *lbits == 8)
            }
            (FracPack(ltype), FracPack(rtype)) => self.compare(ltype, rtype),
            (FracPack(..), List(ritem)) => {
                self.allowed_difference
                    .includes(SchemaDifference::ADD_ALTERNATIVE)
                    && matches!(Self::resolve_all(self.schema2, ritem), Int { bits: 8, .. })
            }
            (List(litem), FracPack(..)) => {
                self.allowed_difference
                    .includes(SchemaDifference::DROP_ALTERNATIVE)
                    && matches!(Self::resolve_all(self.schema1, litem), Int { bits: 8, .. })
            }
            _ => false,
        };

        self.on_stack.remove(&(prhs as *const AnyType));
        self.on_stack.remove(&(plhs as *const AnyType));
        result
    }
}
