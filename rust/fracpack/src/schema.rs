use crate::{Pack, Unpack};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::any::TypeId;
use std::collections::HashMap;

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

pub use indexmap;

#[derive(Debug, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "crate")]
pub struct Schema(IndexMap<String, AnyType>);

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "crate")]
pub enum AnyType {
    Struct(IndexMap<String, AnyType>),
    Object(IndexMap<String, AnyType>),
    Array {
        #[serde(rename = "type")]
        type_: Box<AnyType>,
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

impl VisitTypes for AnyType {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        visit_types(self, f);
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

#[cfg(test)]
mod tests {
    use super::*;

    use psibase_macros::ToSchema;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, ToSchema)]
    #[fracpack(fracpack_mod = "crate")]
    struct SchemaTest {
        i: i32,
        f: f32,
        b: bool,
        o: Option<i32>,
        v: Vec<i8>,
        s: String,
        bx: Box<String>,
        a: [i8; 10],
    }

    #[derive(Serialize, Deserialize, ToSchema)]
    #[fracpack(fracpack_mod = "crate", custom = "hex")]
    enum EnumTest {
        S1 { o: Option<Box<EnumTest>> },
        S2(i32),
    }

    #[test]
    fn test_build_schema() -> Result<(), anyhow::Error> {
        let mut builder = SchemaBuilder::new();
        builder.insert_named::<SchemaTest>("s".to_string());
        builder.insert_named::<EnumTest>("e".to_string());
        let s = serde_json::to_string(&builder.build())?;
        eprintln!("{}", s);
        assert!(&s == "");
        Ok(())
    }
}
