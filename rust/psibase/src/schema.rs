use crate::{AccountNumber, Action, DbId, Hex, MethodNumber, SchemaMap, SharedAction};
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
            // Compare tables by their declared numeric `table` index
            let l_by_idx: std::collections::HashMap<u16, &TableInfo> =
                ltables.iter().map(|t| (t.table, t)).collect();

            for rtab in rtables {
                let Some(ltab) = l_by_idx.get(&rtab.table) else {
                    let table_name = rtab.name.as_ref().map_or("<unnamed>", |n| n.as_str());
                    panic!("Extra table {}::{} (index {})", db, table_name, rtab.table);
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
    let index = registry.index().unwrap();
    let mut accounts = HashSet::new();
    accounts.insert(my_schema.service);
    let mut schemas = SchemaMap::new();
    let mut names = Vec::new();
    for info in &index {
        if info.accounts.contains(&my_schema.service) {
            names.push(info.name.as_str());
            let package = block_on(registry.get_by_info(info)).unwrap();
            package.get_schemas(&mut accounts, &mut schemas).unwrap();
        }
    }
    assert!(
        !names.is_empty(),
        "Cannot find package containing {}",
        my_schema.service
    );
    let real_schema = schemas.get(&my_schema.service).unwrap_or_else(|| {
        panic!(
            "no schema for service {} after loading {};",
            my_schema.service,
            names.join(", "),
        )
    });
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

pub fn field_types<const N: usize>(ty: &CompiledType) -> Option<[usize; N]> {
    if let CompiledType::Object { children } = ty {
        let children: &[_; N] = children[..].try_into().ok()?;
        return Some(children.each_ref().map(|child| child.1));
    }
    None
}

pub fn field_names<const N: usize>(ty: &CompiledType) -> Option<[&str; N]> {
    if let CompiledType::Object { children } = ty {
        let children: &[_; N] = children[..].try_into().ok()?;
        return Some(children.each_ref().map(|child| child.0.as_str()));
    }
    None
}

pub trait TypeMatchExt {
    fn matches_action(&self, ty: &CompiledType) -> bool;
}

impl TypeMatchExt for CompiledSchema<'_> {
    fn matches_action(&self, ty: &CompiledType) -> bool {
        if let Some([sender_type, service_type, method_type, raw_data_type]) = field_types::<4>(ty)
        {
            self.matches_u64(sender_type)
                && self.matches_u64(service_type)
                && self.matches_u64(method_type)
                && self.matches_bytes(raw_data_type)
        } else {
            false
        }
    }
}

pub struct CustomPrettyAction<'a> {
    schemas: &'a SchemaMap,
}

impl<'a> CustomPrettyAction<'a> {
    pub fn new(schemas: &'a SchemaMap) -> Self {
        Self { schemas }
    }
}

pub fn deserialize_pretty_action<'a>(
    ty: &'a CompiledType,
    val: &serde_json::Value,
) -> Result<(AccountNumber, AccountNumber, MethodNumber, &'a str), serde_json::Error> {
    use serde::de::Error;
    let [sender_name, service_name, method_name, raw_data_name] = field_names::<4>(ty).unwrap();
    let Some(object) = val.as_object() else {
        Err(serde_json::Error::custom("expected object"))?
    };

    let sender = AccountNumber::deserialize(
        object
            .get(sender_name)
            .ok_or_else(|| serde_json::Error::custom(format!("missing field {}", sender_name)))?,
    )?;
    let service =
        AccountNumber::deserialize(object.get(service_name).ok_or_else(|| {
            serde_json::Error::custom(format!("missing field {}", service_name))
        })?)?;
    let method = MethodNumber::deserialize(
        object
            .get(method_name)
            .ok_or_else(|| serde_json::Error::custom(format!("missing field {}", method_name)))?,
    )?;
    Ok((sender, service, method, raw_data_name))
}

impl<'a> CustomHandler for CustomPrettyAction<'a> {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        schema.matches_action(ty)
    }
    fn frac2json(
        &self,
        parent_schema: &CompiledSchema,
        ty: &CompiledType,
        src: &mut FracInputStream,
        _allow_empty_container: bool,
    ) -> Result<serde_json::Value, fracpack::Error> {
        let [sender_name, service_name, method_name, raw_data_name] = field_names::<4>(ty).unwrap();
        let value = SharedAction::unpack(src)?;
        let mut method = MethodString(value.method.to_string());
        let mut data = None;
        if let Some(schema) = self.schemas.get(&value.service) {
            if let Some((key, action_type)) = schema.actions.get_key_value(&method) {
                method = key.clone();

                let mut cschema = CompiledSchema::new(&schema.types, parent_schema.get_custom());
                cschema.extend(&action_type.params);
                data = cschema.to_value(&action_type.params, value.rawData.0).ok();
            }
        }
        let mut result = serde_json::Map::with_capacity(4);
        result.insert(sender_name.to_owned(), value.sender.to_string().into());
        result.insert(service_name.to_owned(), value.service.to_string().into());
        result.insert(method_name.to_owned(), method.0.into());
        if let Some(data) = data {
            result.insert("data".to_string(), data);
        } else {
            result.insert(raw_data_name.to_owned(), value.rawData.to_string().into());
        }
        Ok(result.into())
    }
    fn json2frac(
        &self,
        parent_schema: &CompiledSchema,
        ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        use serde::de::Error;
        let (sender, service, method, raw_data_name) = deserialize_pretty_action(ty, val)?;

        let mut raw_data = None;
        let err = if let Some(data) = val.get("data") {
            if let Some(schema) = self.schemas.get(&service) {
                if let Some(action_type) = schema.actions.get(&MethodString(method.to_string())) {
                    let mut cschema =
                        CompiledSchema::new(&schema.types, parent_schema.get_custom());
                    cschema.extend(&action_type.params);
                    raw_data = Some(Hex(cschema.from_value(&action_type.params, data)?));
                    String::new()
                } else {
                    format!("Missing action {service}::{method}")
                }
            } else {
                format!("missing schema for {service}")
            }
        } else {
            format!("missing field data")
        };
        let raw_data = if let Some(raw_data) = raw_data {
            raw_data
        } else {
            <Hex<Vec<u8>>>::deserialize(
                val.get(raw_data_name)
                    .ok_or_else(|| serde_json::Error::custom(err))?,
            )?
        };
        Action {
            sender,
            service,
            method,
            rawData: raw_data,
        }
        .pack(dest);
        Ok(())
    }
    fn fracpack_verify(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &mut FracInputStream,
        _allow_empty_container: bool,
    ) -> Result<(), fracpack::Error> {
        SharedAction::verify(src)
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}

pub fn print_schema_impl<T: ToServiceSchema>() {
    print!("{}", serde_json::to_string(&T::schema()).unwrap())
}
