use crate::{AccountNumber, DbId, MethodNumber};
use fracpack::{
    AnyType, CompiledSchema, CompiledType, CustomHandler, CustomTypes, FracInputStream,
    FunctionType, Pack, SchemaBuilder, ToSchema, Unpack, VisitTypes,
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::hash::Hash;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct MethodString(pub String);

impl PartialEq for MethodString {
    fn eq(&self, other: &Self) -> bool {
        self.0
            .parse::<MethodNumber>()
            .unwrap()
            .eq(&other.0.parse::<MethodNumber>().unwrap())
    }
}

impl Eq for MethodString {}

impl Hash for MethodString {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.parse::<MethodNumber>().unwrap().hash(state)
    }
}

impl std::fmt::Display for MethodString {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> Result<(), std::fmt::Error> {
        self.0.fmt(f)
    }
}

type EventMap = IndexMap<MethodString, AnyType>;

type ActionMap = IndexMap<MethodString, FunctionType>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct FieldId {
    pub path: Vec<u32>,
    pub transform: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<AnyType>,
}

impl VisitTypes for FieldId {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        self.type_.visit_types(f);
    }
}

pub type IndexInfo = Vec<FieldId>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TableInfo {
    pub name: Option<String>,
    pub table: u16,
    #[serde(rename = "type")]
    pub type_: AnyType,
    pub indexes: Vec<IndexInfo>,
}

impl VisitTypes for TableInfo {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        self.type_.visit_types(f);
        self.indexes.visit_types(f);
    }
}

pub fn db_name(db: DbId) -> String {
    match db {
        DbId::Service => "service".to_string(),
        DbId::Subjective => "subjective".to_string(),
        DbId::WriteOnly => "writeOnly".to_string(),
        _ => panic!("Unsupported db"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Schema {
    pub service: AccountNumber,
    pub types: fracpack::Schema,
    pub actions: ActionMap,
    pub ui: EventMap,
    pub history: EventMap,
    pub merkle: EventMap,
    pub database: Option<IndexMap<String, Vec<TableInfo>>>,
}

#[cfg(test)]
pub(crate) fn assert_schemas_equivalent(lhs: &Schema, rhs: &Schema) {
    let mut matcher = fracpack::SchemaMatcher::new(
        &lhs.types,
        &rhs.types,
        fracpack::SchemaDifference::EQUIVALENT,
    );
    for (name, lty) in &lhs.actions {
        if let Some(rty) = rhs.actions.get(name) {
            if !matcher.compare(&lty.params, &rty.params) {
                panic!("Parameter types for action {} do not match", name);
            }
            match (&lty.result, &rty.result) {
                (Some(lres), Some(rres)) => {
                    if !matcher.compare(lres, rres) {
                        panic!("Return type for {} does not match", name);
                    }
                }
                (None, None) => (),
                (Some(..), None) => panic!("Missing return type for {}", name),
                (None, Some(..)) => panic!("Extra return type for {}", name),
            }
        } else {
            panic!("Missing action {}", name);
        }
    }
    for name in rhs.actions.keys() {
        if !lhs.actions.contains_key(name) {
            panic!("Extra action {}", name);
        }
    }
    for (levents, revents) in [
        (&lhs.ui, &rhs.ui),
        (&lhs.history, &rhs.history),
        (&lhs.merkle, &rhs.merkle),
    ] {
        for (name, lty) in levents {
            if let Some(rty) = revents.get(name) {
                if !matcher.compare(lty, rty) {
                    panic!("Type for event {} does not match", name);
                }
            } else {
                panic!("Missing event {}", name)
            }
        }
        for name in revents.keys() {
            if !levents.contains_key(name) {
                panic!("Extra event {}", name);
            }
        }
    }
    // Allow tables to be missing
    if let Some(rdb) = &rhs.database {
        for (db, rtables) in rdb {
            let empty_tables = Vec::new();
            let ltables = lhs
                .database
                .as_ref()
                .and_then(|tables| tables.get(db))
                .unwrap_or(&empty_tables);
            if ltables.len() < rtables.len() {
                panic!("Extra tables in {}", db);
            }

            // Compare tables by their declared numeric `table` index
            let l_by_idx: std::collections::HashMap<u16, &TableInfo> =
                ltables.iter().map(|t| (t.table, t)).collect();

            for rtab in rtables {
                let Some(ltab) = l_by_idx.get(&rtab.table) else {
                    let table_name = rtab.name.as_ref().map_or("<unnamed>", |n| n.as_str());
                    panic!(
                        "Missing table {}::{} (index {})",
                        db, table_name, rtab.table
                    );
                };

                let table_name = ltab
                    .name
                    .as_ref()
                    .or(rtab.name.as_ref())
                    .map_or("<unnamed>", |n| n.as_str());
                if !matcher.compare(&ltab.type_, &rtab.type_) {
                    panic!("Type for table {}::{} does not match", db, table_name);
                }
                if ltab.indexes.len() < rtab.indexes.len() {
                    panic!("Too many indexes for table {}::{}", db, table_name);
                }
                for (lindex, rindex) in std::iter::zip(&ltab.indexes, &rtab.indexes) {
                    if lindex.len() != rindex.len() {
                        panic!("Index does not match in {}::{}", db, table_name);
                    }
                    for (lfield, rfield) in std::iter::zip(lindex, rindex) {
                        let tymatch = match (&lfield.type_, &rfield.type_) {
                            (Some(lty), Some(rty)) => matcher.compare(lty, rty),
                            (None, None) => true,
                            _ => false,
                        };
                        if !tymatch
                            || &lfield.path != &rfield.path
                            || lfield.transform != rfield.transform
                        {
                            panic!("Index does not match in {}::{}", db, table_name);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn assert_schema_matches_package<Wrapper: ToServiceSchema>() {
    use crate::{DirectoryRegistry, PackageRegistry, SchemaMap};
    use futures::executor::block_on;
    use std::collections::HashSet;
    use std::path::PathBuf;

    let my_schema = Wrapper::schema();
    let registry = DirectoryRegistry::new(
        PathBuf::from(std::env::var("PSIBASE_DATADIR").unwrap()).join("packages"),
    );
    let info = registry
        .index()
        .unwrap()
        .into_iter()
        .find(|info| info.accounts.contains(&my_schema.service))
        .expect(&format!(
            "Cannot find package containing {}",
            my_schema.service
        ));
    let package = block_on(registry.get_by_info(&info)).unwrap();
    let mut accounts = HashSet::new();
    accounts.insert(my_schema.service);
    let mut schemas = SchemaMap::new();
    package.get_schemas(&mut accounts, &mut schemas).unwrap();
    let real_schema = schemas.get(&my_schema.service).unwrap();
    assert_schemas_equivalent(real_schema, &my_schema);
}

pub trait ToActionsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodString, FunctionType>;
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodString, AnyType>;
}

pub trait ToIndexSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Vec<IndexInfo>;
}

pub trait ToDatabaseSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Option<IndexMap<String, Vec<TableInfo>>>;
}

pub struct EmptyDatabase;

impl ToDatabaseSchema for EmptyDatabase {
    fn to_schema(_builder: &mut SchemaBuilder) -> Option<IndexMap<String, Vec<TableInfo>>> {
        Some(IndexMap::new())
    }
}

pub trait ToServiceSchema {
    type UiEvents: ToEventsSchema;
    type HistoryEvents: ToEventsSchema;
    type MerkleEvents: ToEventsSchema;
    type Actions: ToActionsSchema;
    type Database: ToDatabaseSchema;
    const SERVICE: AccountNumber;
    fn schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut actions = Self::Actions::to_schema(&mut builder);
        let mut ui = Self::UiEvents::to_schema(&mut builder);
        let mut history = Self::HistoryEvents::to_schema(&mut builder);
        let mut merkle = Self::MerkleEvents::to_schema(&mut builder);
        let mut database = Self::Database::to_schema(&mut builder);
        let types = builder.build_ext(&mut (
            &mut actions,
            &mut ui,
            &mut history,
            &mut merkle,
            &mut database,
        ));
        Schema {
            service: Self::SERVICE,
            types,
            actions,
            ui,
            history,
            merkle,
            database,
        }
    }
    fn actions_schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut actions = Self::Actions::to_schema(&mut builder);
        let types = builder.build_ext(&mut [&mut actions][..]);
        Schema {
            service: Self::SERVICE,
            types,
            actions,
            ui: Default::default(),
            history: Default::default(),
            merkle: Default::default(),
            database: Default::default(),
        }
    }
}

struct CustomAccountNumber;

impl CustomHandler for CustomAccountNumber {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        matches!(
            schema.unwrap_struct(ty),
            CompiledType::Int {
                bits: 64,
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
    ) -> Result<serde_json::Value, fracpack::Error> {
        Ok(AccountNumber::new(u64::unpack(src)?).to_string().into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(AccountNumber::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

struct CustomMethodNumber;

impl CustomHandler for CustomMethodNumber {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        matches!(
            schema.unwrap_struct(ty),
            CompiledType::Int {
                bits: 64,
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
    ) -> Result<serde_json::Value, fracpack::Error> {
        Ok(MethodNumber::new(u64::unpack(src)?).to_string().into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(MethodNumber::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

pub fn schema_types() -> CustomTypes<'static> {
    let mut result = fracpack::standard_types();
    static ACCOUNT_NUMBER: CustomAccountNumber = CustomAccountNumber;
    static METHOD_NUMBER: CustomMethodNumber = CustomMethodNumber;
    result.insert("AccountNumber".to_string(), &ACCOUNT_NUMBER);
    result.insert("MethodNumber".to_string(), &METHOD_NUMBER);
    result
}

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}

pub fn print_schema_impl<T: ToServiceSchema>() {
    println!(
        "psibase-schema-gen-output: {}",
        serde_json::to_string(&T::schema()).unwrap()
    )
}
