//! The schema of a service: its actions, events and tables over PSIO's
//! Schema IR.
//!
//! `ServiceSchema` and its three records are the Rust twins of the C++
//! records of the same names (`psibase/schema.hpp`); the document has two
//! encodings, I-JSON (schema files, `service/<account>.json`, the install
//! manifest, `GET …/schema`) and PSSZ (the argument of
//! `packages::setSchema` and the stored row).

use crate::services::transact::ServiceMethod;
use crate::{AccountNumber, Action, DbId, MethodNumber, SchemaMap};
use psio::pssz::dynamic::{self, Compare, CustomHandlers, JsonContext};
use psio::pssz::schema_ir::{AnyType, FunctionType, SchemaBuilder};
use psio::pssz::PsszError;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// One component of an index key.
#[derive(
    Debug,
    Clone,
    PartialEq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct FieldId {
    /// Member indexes from the row type down
    pub path: Vec<u32>,
    /// Name of a key transform, if any
    pub transform: Option<String>,
    /// The transform's result type, if any
    pub r#type: Option<AnyType>,
}

pub type IndexInfo = Vec<FieldId>;

#[derive(
    Debug,
    Clone,
    PartialEq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct TableInfo {
    /// Table type name ("AccountTable")
    pub name: Option<String>,
    /// Table number
    pub table: u16,
    /// Row type
    pub r#type: AnyType,
    /// `[0]` is the primary key
    pub indexes: Vec<IndexInfo>,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct EventType {
    /// The event's argument list
    pub r#type: AnyType,
    /// "public" | "private"
    pub access: String,
}

pub type ActionMap = BTreeMap<String, FunctionType>;
pub type EventMap = BTreeMap<String, EventType>;
pub type DatabaseMap = BTreeMap<String, Vec<TableInfo>>;

pub fn db_name(db: DbId) -> String {
    match db {
        DbId::Service => "service".to_string(),
        DbId::Subjective => "subjective".to_string(),
        DbId::WriteOnly => "writeOnly".to_string(),
        DbId::Session => "session".to_string(),
        _ => panic!("Unsupported db"),
    }
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct ServiceSchema {
    /// The service's account
    pub service: AccountNumber,
    /// The Schema IR document; every node the other members name resolves in it
    pub types: psio::pssz::schema_ir::Schema,
    /// By action name as declared
    pub actions: ActionMap,
    /// By event name as declared
    pub history: EventMap,
    pub merkle: EventMap,
    /// "service" | "writeOnly" | "subjective" | "session"
    pub database: Option<DatabaseMap>,
}

/// The entry of `map` whose name has the method number `method`. The key of
/// an action or event is its name exactly as declared; a caller holds its
/// number.
fn by_method<T>(map: &BTreeMap<String, T>, method: MethodNumber) -> Option<(&String, &T)> {
    map.iter()
        .find(|(name, _)| MethodNumber::from(name.as_str()) == method)
}

impl ServiceSchema {
    /// The action with the method number `method`, with its declared name.
    pub fn action(&self, method: MethodNumber) -> Option<(&String, &FunctionType)> {
        by_method(&self.actions, method)
    }
    /// The action called `name` (compared by method number).
    pub fn action_by_name(&self, name: &str) -> Option<(&String, &FunctionType)> {
        self.actions
            .get_key_value(name)
            .or_else(|| self.action(MethodNumber::from(name)))
    }
    pub fn history_event(&self, method: MethodNumber) -> Option<(&String, &EventType)> {
        by_method(&self.history, method)
    }
    pub fn merkle_event(&self, method: MethodNumber) -> Option<(&String, &EventType)> {
        by_method(&self.merkle, method)
    }
}

/// Panics unless the two schemas describe the same wire contract: the same
/// actions, events and (where `rhs` has them) tables, each with equivalent
/// types. Names and text forms are not compared (`Compare::Wire`): the two
/// may come from different languages.
#[cfg(test)]
pub(crate) fn assert_schemas_equivalent(lhs: &ServiceSchema, rhs: &ServiceSchema) {
    let same = |what: String, lty: &AnyType, rty: &AnyType| {
        let result = dynamic::equivalent(&lhs.types, lty, &rhs.types, rty, Compare::Wire);
        if !result.ok {
            panic!("{} does not match: {} ({})", what, result.reason, result.path);
        }
    };
    for (name, lty) in &lhs.actions {
        let Some((_, rty)) = rhs.action_by_name(name) else {
            panic!("Missing action {}", name);
        };
        same(
            format!("Parameter types for action {}", name),
            &lty.params,
            &rty.params,
        );
        match (&lty.result, &rty.result) {
            (Some(lres), Some(rres)) => same(format!("Return type for {}", name), lres, rres),
            (None, None) => (),
            (Some(..), None) => panic!("Missing return type for {}", name),
            (None, Some(..)) => panic!("Extra return type for {}", name),
        }
    }
    for name in rhs.actions.keys() {
        if lhs.action_by_name(name).is_none() {
            panic!("Extra action {}", name);
        }
    }
    for (levents, revents) in [(&lhs.history, &rhs.history), (&lhs.merkle, &rhs.merkle)] {
        for (name, lty) in levents {
            let Some((_, rty)) = by_method(revents, MethodNumber::from(name.as_str())) else {
                panic!("Missing event {}", name)
            };
            same(format!("Type for event {}", name), &lty.r#type, &rty.r#type);
            if lty.access != rty.access {
                panic!("Access for event {} does not match", name);
            }
        }
        for name in revents.keys() {
            if by_method(levents, MethodNumber::from(name.as_str())).is_none() {
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
                same(
                    format!("Type for table {}::{}", db, table_name),
                    &ltab.r#type,
                    &rtab.r#type,
                );
                if ltab.indexes.len() < rtab.indexes.len() {
                    panic!("Too many indexes for table {}::{}", db, table_name);
                }
                for (lindex, rindex) in std::iter::zip(&ltab.indexes, &rtab.indexes) {
                    if lindex.len() != rindex.len() {
                        panic!("Index does not match in {}::{}", db, table_name);
                    }
                    for (lfield, rfield) in std::iter::zip(lindex, rindex) {
                        let tymatch = match (&lfield.r#type, &rfield.r#type) {
                            (Some(lty), Some(rty)) => {
                                dynamic::equivalent(&lhs.types, lty, &rhs.types, rty, Compare::Wire)
                                    .ok
                            }
                            (None, None) => true,
                            _ => false,
                        };
                        if !tymatch
                            || lfield.path != rfield.path
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

/// The actions of a service: for each, the node of its argument list and
/// of its result, inserted in declaration order.
pub trait ToActionsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> ActionMap;
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> EventMap;
}

pub trait ToIndexSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Vec<IndexInfo>;
}

pub trait ToDatabaseSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Option<DatabaseMap>;
}

pub struct EmptyDatabase;

impl ToDatabaseSchema for EmptyDatabase {
    fn to_schema(_builder: &mut SchemaBuilder) -> Option<DatabaseMap> {
        Some(DatabaseMap::new())
    }
}

/// No events of one kind.
pub struct NoEvents;

impl ToEventsSchema for NoEvents {
    fn to_schema(_builder: &mut SchemaBuilder) -> EventMap {
        EventMap::new()
    }
}

/// The node of an action's argument list and of its result. Used by what
/// `#[psibase::service]` generates.
pub fn function_type<M>(builder: &mut SchemaBuilder) -> FunctionType
where
    M: psio::interface::Method + psio::pssz::schema_ir::ToPsszSchema,
    M::Result: psio::pssz::schema_ir::ToPsszSchema,
{
    let params = Box::new(
        builder
            .insert::<M>()
            .expect("the argument list of an action has a schema"),
    );
    let result = M::HAS_RESULT.then(|| {
        Box::new(
            builder
                .insert::<M::Result>()
                .expect("the result of an action has a schema"),
        )
    });
    FunctionType { params, result }
}

/// The node of an event's argument list.
pub fn event_type<M>(builder: &mut SchemaBuilder, access: &str) -> EventType
where
    M: psio::interface::Method + psio::pssz::schema_ir::ToPsszSchema,
{
    EventType {
        r#type: builder
            .insert::<M>()
            .expect("the argument list of an event has a schema"),
        access: access.to_string(),
    }
}

pub trait ToServiceSchema {
    type HistoryEvents: ToEventsSchema;
    type MerkleEvents: ToEventsSchema;
    type Actions: ToActionsSchema;
    type Database: ToDatabaseSchema;
    const SERVICE: AccountNumber;
    fn schema() -> ServiceSchema {
        let mut builder = SchemaBuilder::new();
        let actions = Self::Actions::to_schema(&mut builder);
        let history = Self::HistoryEvents::to_schema(&mut builder);
        let merkle = Self::MerkleEvents::to_schema(&mut builder);
        let database = Self::Database::to_schema(&mut builder);
        ServiceSchema {
            service: Self::SERVICE,
            types: builder.finish(),
            actions,
            history,
            merkle,
            database,
        }
    }
    fn actions_schema() -> ServiceSchema {
        let mut builder = SchemaBuilder::new();
        let actions = Self::Actions::to_schema(&mut builder);
        ServiceSchema {
            service: Self::SERVICE,
            types: builder.finish(),
            actions,
            history: Default::default(),
            merkle: Default::default(),
            database: Default::default(),
        }
    }
}

/// The text forms of psibase's custom types for schema-driven JSON
/// (`psio::pssz::dynamic`): `AccountNumber` and `MethodNumber` as their
/// names.
pub fn schema_handlers() -> CustomHandlers {
    let mut handlers = CustomHandlers::new();
    handlers
        .add_type::<AccountNumber>()
        .expect("AccountNumber is a custom type");
    handlers
        .add_type::<MethodNumber>()
        .expect("MethodNumber is a custom type");
    handlers
}

fn json_error(e: impl std::fmt::Display) -> PsszError {
    PsszError::from(e.to_string())
}

/// The JSON of the arguments of `service::method` packed in `raw_data`,
/// by the service's schema, with the declared spelling of the method; None
/// when the schema is not known or does not describe them.
pub fn action_data_to_json(
    schemas: &SchemaMap,
    handlers: &CustomHandlers,
    service: AccountNumber,
    method: MethodNumber,
    raw_data: &[u8],
) -> Option<(String, String)> {
    let schema = schemas.get(&service)?;
    let (name, action_type) = schema.action(method)?;
    let (text, _) = dynamic::pssz_to_json_with::<psio::IJson>(
        &schema.types,
        &action_type.params,
        raw_data,
        handlers,
    )
    .ok()?;
    Some((name.clone(), text))
}

/// The packed arguments of `service::method` from their JSON, by the
/// service's schema.
pub fn action_data_from_json(
    schemas: &SchemaMap,
    handlers: &CustomHandlers,
    service: AccountNumber,
    method: MethodNumber,
    data: &str,
) -> Result<Vec<u8>, anyhow::Error> {
    let Some(schema) = schemas.get(&service) else {
        return Err(anyhow::anyhow!("missing schema for {service}"));
    };
    let Some((_, action_type)) = schema.action(method) else {
        return Err(anyhow::anyhow!("Missing action {service}::{method}"));
    };
    dynamic::json_to_pssz_with::<psio::IJson>(
        &schema.types,
        &action_type.params,
        data.as_bytes(),
        handlers,
    )
    .map_err(|e| anyhow::anyhow!("{service}::{method}: {e}"))
}

/// [`schema_handlers`], and the presentation of an `Action` and of a
/// `ServiceMethod` by the schemas of the services they name:
///
/// * an action is `{sender, service, method, data}` where `data` is the
///   argument list decoded with the called service's schema and `method`
///   has its declared spelling; an action whose service or method the
///   schemas do not describe is `{sender, service, method, rawData}`. A
///   reader takes either form;
/// * a service method is `{service, method}` with the declared spelling.
pub fn action_handlers(schemas: Arc<SchemaMap>) -> CustomHandlers {
    action_handlers_recording(schemas, Arc::new(Mutex::new(Vec::new())))
}

/// [`action_handlers`]; a service that an action being read from JSON
/// calls and `schemas` has no schema for is pushed to `missing`.
pub fn action_handlers_recording(
    schemas: Arc<SchemaMap>,
    missing: Arc<Mutex<Vec<AccountNumber>>>,
) -> CustomHandlers {
    let mut handlers = schema_handlers();
    let (writing, reading) = (schemas.clone(), schemas.clone());
    handlers.add_json(
        "Action",
        move |pssz: &[u8], context: &JsonContext<'_>| {
            let act: Action = psio::from_pssz(pssz)?;
            let mut result = serde_json::Map::with_capacity(4);
            result.insert("sender".to_string(), act.sender.to_string().into());
            result.insert("service".to_string(), act.service.to_string().into());
            match action_data_to_json(
                &writing,
                context.handlers,
                act.service,
                act.method,
                &act.rawData.0,
            ) {
                Some((name, data)) => {
                    result.insert("method".to_string(), name.into());
                    result.insert(
                        "data".to_string(),
                        serde_json::from_str(&data).map_err(json_error)?,
                    );
                }
                None => {
                    result.insert("method".to_string(), act.method.to_string().into());
                    result.insert("rawData".to_string(), act.rawData.to_string().into());
                }
            }
            Ok(serde_json::Value::Object(result).to_string())
        },
        move |json: &str, context: &JsonContext<'_>| {
            let value: serde_json::Value = serde_json::from_str(json).map_err(json_error)?;
            let text = |key: &str| {
                value
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| PsszError::from(format!("missing field {key}")))
            };
            let sender: AccountNumber = text("sender")?.parse().map_err(json_error)?;
            let service: AccountNumber = text("service")?.parse().map_err(json_error)?;
            let method = MethodNumber::from(text("method")?);
            let raw_data = if let Some(data) = value.get("data") {
                if !reading.contains_key(&service) {
                    missing.lock().unwrap().push(service);
                }
                action_data_from_json(
                    &reading,
                    context.handlers,
                    service,
                    method,
                    &data.to_string(),
                )
                .map_err(json_error)?
            } else {
                text("rawData")?
                    .parse::<crate::Hex<Vec<u8>>>()
                    .map_err(json_error)?
                    .0
            };
            Ok(psio::to_pssz(&Action {
                sender,
                service,
                method,
                rawData: raw_data.into(),
            }))
        },
    );
    let writing = schemas;
    handlers.add_json(
        "ServiceMethod",
        move |pssz: &[u8], _context: &JsonContext<'_>| {
            let value: ServiceMethod = psio::from_pssz(pssz)?;
            let method = writing
                .get(&value.service)
                .and_then(|schema| schema.action(value.method))
                .map(|(name, _)| name.clone())
                .unwrap_or_else(|| value.method.to_string());
            Ok(serde_json::json!({"service": value.service.to_string(), "method": method})
                .to_string())
        },
        move |json: &str, _context: &JsonContext<'_>| {
            let value: serde_json::Value = serde_json::from_str(json).map_err(json_error)?;
            let text = |key: &str| {
                value
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| PsszError::from(format!("missing field {key}")))
            };
            Ok(psio::to_pssz(&ServiceMethod {
                service: text("service")?.parse().map_err(json_error)?,
                method: MethodNumber::from(text("method")?),
            }))
        },
    );
    handlers
}

/// Presents actions by the schemas of the services they call: the declared
/// spelling of a method, the arguments and the result as JSON
/// ([`action_handlers`]).
pub struct ActionDecoder {
    schemas: Arc<SchemaMap>,
    handlers: CustomHandlers,
}

impl ActionDecoder {
    pub fn new(schemas: Arc<SchemaMap>) -> Self {
        let handlers = action_handlers(schemas.clone());
        Self { schemas, handlers }
    }
    /// A decoder that knows no service.
    pub fn empty() -> Self {
        Self::new(Arc::new(SchemaMap::new()))
    }
    pub fn schemas(&self) -> &SchemaMap {
        &self.schemas
    }
    pub fn handlers(&self) -> &CustomHandlers {
        &self.handlers
    }
    /// Whether the schema of `service` describes `method`.
    pub fn describes(&self, service: AccountNumber, method: MethodNumber) -> bool {
        self.schemas
            .get(&service)
            .is_some_and(|schema| schema.action(method).is_some())
    }
    /// The method's name as the service declares it, or the text of its
    /// number.
    pub fn method_name(&self, service: AccountNumber, method: MethodNumber) -> String {
        self.schemas
            .get(&service)
            .and_then(|schema| schema.action(method))
            .map_or_else(|| method.to_string(), |(name, _)| name.clone())
    }
    /// The arguments of `action` as JSON: None when the schemas do not
    /// describe the action, an error when the bytes are not its arguments.
    pub fn args(&self, action: &Action) -> Option<Result<serde_json::Value, anyhow::Error>> {
        let schema = self.schemas.get(&action.service)?;
        let (_, action_type) = schema.action(action.method)?;
        Some(self.to_value(schema, &action_type.params, &action.rawData.0))
    }
    /// The result of `service::method` as JSON: None when the schemas do
    /// not describe the action or it has no result.
    pub fn retval(
        &self,
        service: AccountNumber,
        method: MethodNumber,
        raw_retval: &[u8],
    ) -> Option<Result<serde_json::Value, anyhow::Error>> {
        let schema = self.schemas.get(&service)?;
        let (_, action_type) = schema.action(method)?;
        let result_type = action_type.result.as_ref()?;
        Some(self.to_value(schema, result_type, raw_retval))
    }
    fn to_value(
        &self,
        schema: &ServiceSchema,
        ty: &AnyType,
        bytes: &[u8],
    ) -> Result<serde_json::Value, anyhow::Error> {
        let (text, _) =
            dynamic::pssz_to_json_with::<psio::IJson>(&schema.types, ty, bytes, &self.handlers)
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(serde_json::from_str(&text)?)
    }
    /// The packed arguments of `service::method` from their JSON.
    pub fn pack_args(
        &self,
        service: AccountNumber,
        method: MethodNumber,
        data: &serde_json::Value,
    ) -> Result<Vec<u8>, anyhow::Error> {
        action_data_from_json(
            &self.schemas,
            &self.handlers,
            service,
            method,
            &data.to_string(),
        )
    }
}

/// What the arguments of an action name besides their own service.
#[derive(Default)]
pub struct NestedCalls {
    /// The actions packed inside the arguments
    pub actions: Vec<Action>,
    /// The service methods named in the arguments
    pub methods: Vec<ServiceMethod>,
}

/// The actions and service methods inside the arguments of
/// `service::method`, by the service's schema (one level: an action found
/// is not looked into). Nothing when the schema does not describe the
/// arguments or they are not valid.
pub fn nested_calls(
    schemas: &SchemaMap,
    service: AccountNumber,
    method: MethodNumber,
    raw_data: &[u8],
) -> NestedCalls {
    let found = Arc::new(Mutex::new(NestedCalls::default()));
    if let Some(schema) = schemas.get(&service) {
        if let Some((_, action_type)) = schema.action(method) {
            let mut handlers = schema_handlers();
            let actions = found.clone();
            handlers.add_check("Action", move |pssz: &[u8]| {
                actions
                    .lock()
                    .unwrap()
                    .actions
                    .push(psio::from_pssz::<Action>(pssz)?);
                Ok(())
            });
            let methods = found.clone();
            handlers.add_check("ServiceMethod", move |pssz: &[u8]| {
                methods
                    .lock()
                    .unwrap()
                    .methods
                    .push(psio::from_pssz::<ServiceMethod>(pssz)?);
                Ok(())
            });
            let _ = dynamic::validate_pssz_with(
                &schema.types,
                &action_type.params,
                raw_data,
                &handlers,
            );
        }
    }
    let mut found = found.lock().unwrap();
    std::mem::take(&mut *found)
}

pub fn create_schema<T: ToServiceSchema>() -> ServiceSchema {
    T::schema()
}

pub fn print_schema_impl<T: ToServiceSchema>() {
    print!("{}", psio::to_ijson(&T::schema()))
}
