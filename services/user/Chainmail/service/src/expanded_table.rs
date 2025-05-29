// Recursive expansion of service macro
// =====================================

#[allow(dead_code)]
mod service {
    use crate::event_query_helpers::serve_rest_api;
    use crate::tables::SavedMessage;
    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::services::events::Wrapper as EventsSvc;
    use psibase::services::sites::Wrapper as SitesSvc;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        anyhow, check, create_schema, get_sender, serve_graphql, AccountNumber, DbId, Fracpack,
        HttpReply, HttpRequest, MethodNumber, RawKey, Table, TableQuery, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};
    #[doc = " Saved Messages Table"]
    #[doc = " Messages are \"stored\" and accessed as events and via event queries, with nothing in state."]
    #[doc = " This table stores messages a user wants to keep around past a message pruning expiration time."]
    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct SavedMessage {
        pub msg_id: u64,
        pub receiver: AccountNumber,
        pub sender: AccountNumber,
        pub subject: String,
        pub body: String,
        pub datetime: TimePointSec,
    }
    impl SavedMessage {
        fn by_msg_id(&self) -> u64 {
            self.msg_id
        }
        fn by_receiver(&self) -> AccountNumber {
            self.receiver
        }
    }
    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        #[primary_key]
        pk: (),
    }

    impl InitRow {
        fn pk(&self) -> () {
            self.pk
        }
    }
    #[allow(dead_code)]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow { pk: () }).unwrap();
        SitesSvc::call().enableSpa(true);
        EventsSvc::call().setSchema(create_schema::<Wrapper>());
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 0);
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 1);
    }
    #[doc = " Send message"]
    #[doc = " by emiting a `sent` event"]
    #[allow(dead_code)]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(AccountsSvc::call().exists(receiver), &{
            let res = alloc::fmt::format(alloc::__export::format_args!(
                "receiver account {} doesn't exist",
                receiver
            ));
            res
        });
        let datetime = TransactSvc::call().currentBlock().time;
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body, datetime);
    }
    #[doc = " Archive message"]
    #[doc = " by emiting an `archived` event"]
    #[allow(dead_code)]
    fn archive(msg_id: u64) {
        let saved_messages_table = SavedMessagesTable::new();
        if let Some(rec) = saved_messages_table.get_index_pk().get(&msg_id) {
            unsave(
                msg_id,
                rec.sender,
                rec.subject,
                rec.body,
                rec.datetime.seconds,
            );
        }
        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &msg_id.to_string());
    }
    #[doc = " Save a message"]
    #[doc = " Events can be pruned by nodes. Since Chainmail relies on events to \"store\" messages,"]
    #[doc = " `save` copies a message into state where it can be stored indefinitely at the user\'s expense."]
    #[allow(dead_code)]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
        datetime: u32,
    ) {
        check(get_sender() == receiver, &{
            let res = alloc::fmt::format(alloc::__export::format_args!(
                "only receiver of email can save it"
            ));
            res
        });
        let saved_messages_table = SavedMessagesTable::new();
        saved_messages_table
            .put(&SavedMessage {
                msg_id,
                receiver,
                sender,
                subject,
                body,
                datetime: TimePointSec::from(datetime),
            })
            .unwrap();
    }
    #[doc = " Unsave a message"]
    #[doc = " `unsave` releases the state storage for a previously saved message"]
    #[allow(dead_code)]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: u32) {
        let saved_messages_table = SavedMessagesTable::new();
        saved_messages_table.remove(&SavedMessage {
            msg_id,
            receiver: get_sender(),
            sender,
            subject,
            body,
            datetime: TimePointSec::from(datetime),
        });
    }
    use async_graphql::connection::Connection;
    use tables::SavedMessage;
    struct Query;

    impl Query {
        async fn get_saved_msgs(
            &self,
            _: &async_graphql::Context<'_>,
            receiver: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SavedMessage>, async_graphql::Error> {
            TableQuery::subindex::<AccountNumber>(
                SavedMessagesTable::new().get_index_by_attester(),
                &receiver,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }
    }
    #[doc(hidden)]
    #[allow(non_upper_case_globals, unused_attributes, unused_qualifications)]
    const _: () = {
        #[allow(non_camel_case_types)]
        #[doc(hidden)]
        enum __FieldIdent {
            get_saved_msgs,
        }
        impl __FieldIdent {
            fn from_name(name: &async_graphql::Name) -> ::std::option::Option<__FieldIdent> {
                match name.as_str() {
                    "getSavedMsgs" => ::std::option::Option::Some(__FieldIdent::get_saved_msgs),
                    _ => ::std::option::Option::None,
                }
            }
        }
        impl Query {
            #[doc(hidden)]
            #[allow(non_snake_case)]
            async fn __get_saved_msgs_resolver(
                &self,
                ctx: &async_graphql::Context<'_>,
            ) -> async_graphql::ServerResult<::std::option::Option<async_graphql::Value>>
            {
                let f = async {
                    #[allow(non_snake_case, unused_variables, unused_mut)]
                    let (__pos, mut receiver) =
                        ctx.param_value::<AccountNumber>("receiver", ::std::option::Option::None)?;
                    #[allow(non_snake_case, unused_variables)]
                    let receiver = receiver;
                    #[allow(non_snake_case, unused_variables, unused_mut)]
                    let (__pos, mut first) =
                        ctx.param_value::<Option<i32>>("first", ::std::option::Option::None)?;
                    #[allow(non_snake_case, unused_variables)]
                    let first = first;
                    #[allow(non_snake_case, unused_variables, unused_mut)]
                    let (__pos, mut last) =
                        ctx.param_value::<Option<i32>>("last", ::std::option::Option::None)?;
                    #[allow(non_snake_case, unused_variables)]
                    let last = last;
                    #[allow(non_snake_case, unused_variables, unused_mut)]
                    let (__pos, mut before) =
                        ctx.param_value::<Option<String>>("before", ::std::option::Option::None)?;
                    #[allow(non_snake_case, unused_variables)]
                    let before = before;
                    #[allow(non_snake_case, unused_variables, unused_mut)]
                    let (__pos, mut after) =
                        ctx.param_value::<Option<String>>("after", ::std::option::Option::None)?;
                    #[allow(non_snake_case, unused_variables)]
                    let after = after;
                    let res = self
                        .get_saved_msgs(ctx, receiver, first, last, before, after)
                        .await;
                    res.map_err(|err| {
                        ::std::convert::Into::<async_graphql::Error>::into(err)
                            .into_server_error(ctx.item.pos)
                    })
                };
                let obj = f.await.map_err(|err| ctx.set_error_path(err))?;
                let ctx_obj = ctx.with_selection_set(&ctx.item.node.selection_set);
                return async_graphql::OutputType::resolve(&obj, &ctx_obj, ctx.item)
                    .await
                    .map(::std::option::Option::Some);
            }
        }
        #[allow(clippy::all, clippy::pedantic, clippy::suspicious_else_formatting)]
        #[allow(unused_braces, unused_variables, unused_parens, unused_mut)]
        impl async_graphql::resolver_utils::ContainerType for Query {
            async fn resolve_field(
                &self,
                ctx: &async_graphql::Context<'_>,
            ) -> async_graphql::ServerResult<::std::option::Option<async_graphql::Value>>
            {
                let __field = __FieldIdent::from_name(&ctx.item.node.name.node);
                match __field {
                    ::std::option::Option::Some(__FieldIdent::get_saved_msgs) => {
                        return self.__get_saved_msgs_resolver(&ctx).await;
                    }
                    None => {}
                }
                ::std::result::Result::Ok(::std::option::Option::None)
            }
            async fn find_entity(
                &self,
                ctx: &async_graphql::Context<'_>,
                params: &async_graphql::Value,
            ) -> async_graphql::ServerResult<::std::option::Option<async_graphql::Value>>
            {
                let params = match params {
                    async_graphql::Value::Object(params) => params,
                    _ => return ::std::result::Result::Ok(::std::option::Option::None),
                };
                let typename =
                    if let ::std::option::Option::Some(async_graphql::Value::String(typename)) =
                        params.get("__typename")
                    {
                        typename
                    } else {
                        return ::std::result::Result::Err(async_graphql::ServerError::new(
                            r#""__typename" must be an existing string."#,
                            ::std::option::Option::Some(ctx.item.pos),
                        ));
                    };
                ::std::result::Result::Ok(::std::option::Option::None)
            }
        }
        #[allow(clippy::all, clippy::pedantic)]
        impl async_graphql::OutputType for Query {
            fn type_name() -> ::std::borrow::Cow<'static, ::std::primitive::str> {
                ::std::borrow::Cow::Borrowed("Query")
            }
            fn create_type_info(
                registry: &mut async_graphql::registry::Registry,
            ) -> ::std::string::String {
                let ty = registry.create_output_type:: <Self,_>(async_graphql::registry::MetaTypeId::Object, |registry|async_graphql::registry::MetaType::Object {
                    name: ::std::borrow::Cow::into_owned(::std::borrow::Cow::Borrowed("Query")),description: ::std::option::Option::None,fields:{
                        let mut fields = async_graphql::indexmap::IndexMap::new();
                        fields.insert(::std::borrow::ToOwned::to_owned("getSavedMsgs"),async_graphql::registry::MetaField {
                            name: ::std::borrow::ToOwned::to_owned("getSavedMsgs"),description: ::std::option::Option::None,args:{
                                let mut args = async_graphql::indexmap::IndexMap::new();
                                args.insert(::std::borrow::ToOwned::to_owned("receiver"),async_graphql::registry::MetaInputValue {
                                    name: ::std::string::ToString::to_string("receiver"),description: ::std::option::Option::None,ty: <AccountNumber as async_graphql::InputType> ::create_type_info(registry),default_value: ::std::option::Option::None,visible: ::std::option::Option::None,inaccessible:false,tags: (alloc::vec::Vec::new()),is_secret:false,directive_invocations: (alloc::vec::Vec::new()),
                                });
                                args.insert(::std::borrow::ToOwned::to_owned("first"),async_graphql::registry::MetaInputValue {
                                    name: ::std::string::ToString::to_string("first"),description: ::std::option::Option::None,ty: <Option<i32>as async_graphql::InputType> ::create_type_info(registry),default_value: ::std::option::Option::None,visible: ::std::option::Option::None,inaccessible:false,tags: (alloc::vec::Vec::new()),is_secret:false,directive_invocations: (alloc::vec::Vec::new()),
                                });
                                args.insert(::std::borrow::ToOwned::to_owned("last"),async_graphql::registry::MetaInputValue {
                                    name: ::std::string::ToString::to_string("last"),description: ::std::option::Option::None,ty: <Option<i32>as async_graphql::InputType> ::create_type_info(registry),default_value: ::std::option::Option::None,visible: ::std::option::Option::None,inaccessible:false,tags: (alloc::vec::Vec::new()),is_secret:false,directive_invocations: (alloc::vec::Vec::new()),
                                });
                                args.insert(::std::borrow::ToOwned::to_owned("before"),async_graphql::registry::MetaInputValue {
                                    name: ::std::string::ToString::to_string("before"),description: ::std::option::Option::None,ty: <Option<String>as async_graphql::InputType> ::create_type_info(registry),default_value: ::std::option::Option::None,visible: ::std::option::Option::None,inaccessible:false,tags: (alloc::vec::Vec::new()),is_secret:false,directive_invocations: (alloc::vec::Vec::new()),
                                });
                                args.insert(::std::borrow::ToOwned::to_owned("after"),async_graphql::registry::MetaInputValue {
                                    name: ::std::string::ToString::to_string("after"),description: ::std::option::Option::None,ty: <Option<String>as async_graphql::InputType> ::create_type_info(registry),default_value: ::std::option::Option::None,visible: ::std::option::Option::None,inaccessible:false,tags: (alloc::vec::Vec::new()),is_secret:false,directive_invocations: (alloc::vec::Vec::new()),
                                });
                                args
                            },ty: <Connection<RawKey,SavedMessage>as async_graphql::OutputType> ::create_type_info(registry),deprecation:async_graphql::registry::Deprecation::NoDeprecated,cache_control:async_graphql::CacheControl {
                                public:true,max_age:0i32,
                            },external:false,provides: ::std::option::Option::None,requires: ::std::option::Option::None,shareable:false,inaccessible:false,tags: (alloc::vec::Vec::new()),override_from: ::std::option::Option::None,visible: ::std::option::Option::None,compute_complexity: ::std::option::Option::None,directive_invocations: (alloc::vec::Vec::new())
                        });
                        fields
                    },cache_control:async_graphql::CacheControl {
                        public:true,max_age:0i32,
                    },extends:false,shareable:false,resolvable:true,inaccessible:false,interface_object:false,tags: (alloc::vec::Vec::new()),keys: ::std::option::Option::None,visible: ::std::option::Option::None,is_subscription:false,rust_typename: ::std::option::Option::Some(::std::any::type_name:: <Self>()),directive_invocations: (alloc::vec::Vec::new())
                });
                ty
            }
            async fn resolve(
                &self,
                ctx: &async_graphql::ContextSelectionSet<'_>,
                _field: &async_graphql::Positioned<async_graphql::parser::types::Field>,
            ) -> async_graphql::ServerResult<async_graphql::Value> {
                async_graphql::resolver_utils::resolve_container(ctx, self).await
            }
        }
        impl async_graphql::ObjectType for Query {}
    };
    #[doc = " Serve REST calls"]
    #[allow(non_snake_case)]
    #[allow(dead_code)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_rest_api(&request))
    }
    impl psibase::TableRecord for InitRow {
        type PrimaryKey = ();
        const SECONDARY_KEYS: u8 = 0u8;
        const DB: psibase::DbId = psibase::DbId::Service;
        fn get_primary_key(&self) -> RawKey {
            self.pk().to_key()
        }
        fn get_secondary_keys(&self) -> Vec<psibase::RawKey> {
            (alloc::vec::Vec::new())
        }
    }
    struct InitTable {
        db_id: psibase::DbId,
        prefix: Vec<u8>,
    }
    type InitTableRecord = InitRow;
    impl psibase::Table<InitRow> for InitTable {
        const TABLE_INDEX: u16 = 0u16;
        fn with_prefix(db_id: psibase::DbId, prefix: Vec<u8>) -> Self {
            InitTable { db_id, prefix }
        }
        fn prefix(&self) -> &[u8] {
            &self.prefix
        }
        fn db_id(&self) -> psibase::DbId {
            self.db_id
        }
    }
    impl InitTable {}

    impl psibase::TableRecord for SavedMessage {
        type PrimaryKey = u64;
        const SECONDARY_KEYS: u8 = 1u8;
        const DB: psibase::DbId = psibase::DbId::Service;
        fn get_primary_key(&self) -> RawKey {
            self.by_msg_id().to_key()
        }
        fn get_secondary_keys(&self) -> Vec<psibase::RawKey> {
            (<[_]>::into_vec(
                #[rustc_box]
                alloc::boxed::Box::new([(psibase::RawKey::new(self.by_receiver().to_key()))]),
            ))
        }
    }
    pub struct SavedMessagesTable {
        db_id: psibase::DbId,
        prefix: Vec<u8>,
    }
    type SavedMessagesTableRecord = SavedMessage;
    impl psibase::Table<SavedMessage> for SavedMessagesTable {
        const TABLE_INDEX: u16 = 1u16;
        fn with_prefix(db_id: psibase::DbId, prefix: Vec<u8>) -> Self {
            SavedMessagesTable { db_id, prefix }
        }
        fn prefix(&self) -> &[u8] {
            &self.prefix
        }
        fn db_id(&self) -> psibase::DbId {
            self.db_id
        }
    }
    impl SavedMessagesTable {
        fn get_index_by_receiver(&self) -> psibase::TableIndex<AccountNumber, SavedMessage> {
            use psibase::Table;
            self.get_index(1u8)
        }
    }
    #[doc = "The account this service normally runs on, \"chainmail\""]
    pub const SERVICE: psibase::AccountNumber = psibase::AccountNumber::new(171964349091u64);
    #[automatically_derived]
    #[allow(non_snake_case)]
    #[allow(non_camel_case_types)]
    #[allow(non_upper_case_globals)]
    #[doc = r" These structs produce the same JSON and fracpack formats"]
    #[doc = r" that the actions do."]
    pub mod action_structs {
        use super::*;
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::init](Actions::init)."]
        pub struct init {}

        impl init {
            pub const ACTION_NAME: &'static str = "init";
        }
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::send](Actions::send)."]
        pub struct send {
            pub receiver: AccountNumber,
            pub subject: String,
            pub body: String,
        }
        impl send {
            pub const ACTION_NAME: &'static str = "send";
        }
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::archive](Actions::archive)."]
        pub struct archive {
            pub msg_id: u64,
        }
        impl archive {
            pub const ACTION_NAME: &'static str = "archive";
        }
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::save](Actions::save)."]
        pub struct save {
            pub msg_id: u64,
            pub receiver: AccountNumber,
            pub sender: AccountNumber,
            pub subject: String,
            pub body: String,
            pub datetime: u32,
        }
        impl save {
            pub const ACTION_NAME: &'static str = "save";
        }
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::unsave](Actions::unsave)."]
        pub struct unsave {
            pub msg_id: u64,
            pub sender: AccountNumber,
            pub subject: String,
            pub body: String,
            pub datetime: u32,
        }
        impl unsave {
            pub const ACTION_NAME: &'static str = "unsave";
        }
        #[derive(
            Debug,
            Clone,
            psibase::Pack,
            psibase::Unpack,
            psibase::fracpack::ToSchema,
            serde::Deserialize,
            serde::Serialize,
        )]
        #[fracpack(fracpack_mod = "psibase::fracpack")]
        #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::serveSys](Actions::serveSys)."]
        pub struct serveSys {
            pub request: HttpRequest,
        }
        impl serveSys {
            pub const ACTION_NAME: &'static str = "serveSys";
        }
    }
    #[derive(Debug, Clone)]
    #[automatically_derived]
    pub struct Actions<T: psibase::Caller> {
        pub caller: T,
    }
    #[automatically_derived]
    #[allow(non_snake_case)]
    #[allow(non_camel_case_types)]
    #[allow(non_upper_case_globals)]
    impl<T: psibase::Caller> Actions<T> {
        pub fn init(&self) -> T::ReturnsNothing {
            self.caller
                .call_returns_nothing(psibase::MethodNumber::new(4231973u64), ())
        }
        #[doc = " Send message"]
        #[doc = " by emiting a `sent` event"]
        pub fn send(
            &self,
            receiver: AccountNumber,
            subject: String,
            body: String,
        ) -> T::ReturnsNothing {
            self.caller.call_returns_nothing(
                psibase::MethodNumber::new(54107u64),
                (receiver, subject, body),
            )
        }
        #[doc = " Archive message"]
        #[doc = " by emiting an `archived` event"]
        pub fn archive(&self, msg_id: u64) -> T::ReturnsNothing {
            self.caller
                .call_returns_nothing(psibase::MethodNumber::new(34016023u64), (msg_id,))
        }
        #[doc = " Save a message"]
        #[doc = " Events can be pruned by nodes. Since Chainmail relies on events to \"store\" messages,"]
        #[doc = " `save` copies a message into state where it can be stored indefinitely at the user\'s expense."]
        pub fn save(
            &self,
            msg_id: u64,
            receiver: AccountNumber,
            sender: AccountNumber,
            subject: String,
            body: String,
            datetime: u32,
        ) -> T::ReturnsNothing {
            self.caller.call_returns_nothing(
                psibase::MethodNumber::new(12634205u64),
                (msg_id, receiver, sender, subject, body, datetime),
            )
        }
        #[doc = " Unsave a message"]
        #[doc = " `unsave` releases the state storage for a previously saved message"]
        pub fn unsave(
            &self,
            msg_id: u64,
            sender: AccountNumber,
            subject: String,
            body: String,
            datetime: u32,
        ) -> T::ReturnsNothing {
            self.caller.call_returns_nothing(
                psibase::MethodNumber::new(739086208u64),
                (msg_id, sender, subject, body, datetime),
            )
        }
        #[doc = " Serve REST calls"]
        pub fn serveSys(&self, request: HttpRequest) -> T::ReturnType<Option<HttpReply>> {
            self.caller.call::<Option<HttpReply>, _>(
                psibase::MethodNumber::new(345945020252u64),
                (request,),
            )
        }
    }
    #[automatically_derived]
    impl<T: psibase::Caller> From<T> for Actions<T> {
        fn from(caller: T) -> Self {
            Self { caller }
        }
    }
    #[automatically_derived]
    impl<T: psibase::Caller> psibase::ToActionsSchema for Actions<T> {
        fn to_schema(
            builder: &mut psibase::fracpack::SchemaBuilder,
        ) -> psibase::fracpack::indexmap::IndexMap<
            psibase::MethodNumber,
            psibase::fracpack::FunctionType,
        > {
            let mut actions = psibase::fracpack::indexmap::IndexMap::new();
            actions.insert(
                psibase::MethodNumber::new(4231973u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::init>(),
                    result: None,
                },
            );
            actions.insert(
                psibase::MethodNumber::new(54107u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::send>(),
                    result: None,
                },
            );
            actions.insert(
                psibase::MethodNumber::new(34016023u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::archive>(),
                    result: None,
                },
            );
            actions.insert(
                psibase::MethodNumber::new(12634205u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::save>(),
                    result: None,
                },
            );
            actions.insert(
                psibase::MethodNumber::new(739086208u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::unsave>(),
                    result: None,
                },
            );
            actions.insert(
                psibase::MethodNumber::new(345945020252u64),
                psibase::fracpack::FunctionType {
                    params: builder.insert::<action_structs::serveSys>(),
                    result: Some(builder.insert::<Option<HttpReply>>()),
                },
            );
            actions
        }
    }
    #[automatically_derived]
    #[derive(Copy, Clone)]
    #[doc = r" Simplifies calling into the service"]
    pub struct Wrapper;

    #[automatically_derived]
    impl Wrapper {
        #[doc = "The account this service normally runs on, \"chainmail\""]
        pub const SERVICE: psibase::AccountNumber = psibase::AccountNumber::new(171964349091u64);
        #[doc = "\n            Call another service.\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which call another service and return the result from the call.\n            This method is only usable by services.\n\n             This method defaults `sender` to [`psibase::get_sender`] and `service` to \"chainmail\"."]
        pub fn call() -> Actions<psibase::ServiceCaller> {
            psibase::ServiceCaller {
                sender: psibase::get_service(),
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            Call another service.\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which call another service and return the result from the call.\n            This method is only usable by services.\n\n             This method defaults `sender` to [`psibase::get_sender`]."]
        pub fn call_to(service: psibase::AccountNumber) -> Actions<psibase::ServiceCaller> {
            psibase::ServiceCaller {
                sender: psibase::get_service(),
                service,
            }
            .into()
        }
        #[doc = "\n            Call another service.\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which call another service and return the result from the call.\n            This method is only usable by services.\n\n             This method defaults `service` to \"chainmail\"."]
        pub fn call_from(sender: psibase::AccountNumber) -> Actions<psibase::ServiceCaller> {
            psibase::ServiceCaller {
                sender,
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            Call another service.\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which call another service and return the result from the call.\n            This method is only usable by services.\n\n            "]
        pub fn call_from_to(
            sender: psibase::AccountNumber,
            service: psibase::AccountNumber,
        ) -> Actions<psibase::ServiceCaller> {
            psibase::ServiceCaller { sender, service }.into()
        }
        #[doc = "\n            push transactions to [psibase::Chain](psibase::Chain).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which push transactions to a test chain and return a\n            [psibase::ChainResult](psibase::ChainResult) or\n            [psibase::ChainEmptyResult](psibase::ChainEmptyResult). This final object\n            can verify success or failure and can retrieve the return value, if any.\n\n             This method defaults both `sender` and `service` to \"chainmail\"."]
        pub fn push(chain: &psibase::Chain) -> Actions<psibase::ChainPusher> {
            psibase::ChainPusher {
                chain,
                sender: Self::SERVICE,
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            push transactions to [psibase::Chain](psibase::Chain).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which push transactions to a test chain and return a\n            [psibase::ChainResult](psibase::ChainResult) or\n            [psibase::ChainEmptyResult](psibase::ChainEmptyResult). This final object\n            can verify success or failure and can retrieve the return value, if any.\n\n             This method defaults `sender` to \"chainmail\"."]
        pub fn push_to(
            chain: &psibase::Chain,
            service: psibase::AccountNumber,
        ) -> Actions<psibase::ChainPusher> {
            psibase::ChainPusher {
                chain,
                sender: Self::SERVICE,
                service,
            }
            .into()
        }
        #[doc = "\n            push transactions to [psibase::Chain](psibase::Chain).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which push transactions to a test chain and return a\n            [psibase::ChainResult](psibase::ChainResult) or\n            [psibase::ChainEmptyResult](psibase::ChainEmptyResult). This final object\n            can verify success or failure and can retrieve the return value, if any.\n\n             This method defaults `service` to \"chainmail\"."]
        pub fn push_from(
            chain: &psibase::Chain,
            sender: psibase::AccountNumber,
        ) -> Actions<psibase::ChainPusher> {
            psibase::ChainPusher {
                chain,
                sender,
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            push transactions to [psibase::Chain](psibase::Chain).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which push transactions to a test chain and return a\n            [psibase::ChainResult](psibase::ChainResult) or\n            [psibase::ChainEmptyResult](psibase::ChainEmptyResult). This final object\n            can verify success or failure and can retrieve the return value, if any.\n\n            "]
        pub fn push_from_to(
            chain: &psibase::Chain,
            sender: psibase::AccountNumber,
            service: psibase::AccountNumber,
        ) -> Actions<psibase::ChainPusher> {
            psibase::ChainPusher {
                chain,
                sender,
                service,
            }
            .into()
        }
        #[doc = "\n            Pack actions into [psibase::Action](psibase::Action).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which pack the action's arguments using [fracpack] and\n            return a [psibase::Action](psibase::Action). The `pack_*` series of\n            functions is mainly useful to applications which push transactions\n            to blockchains.\n\n             This method defaults both `sender` and `service` to \"chainmail\"."]
        pub fn pack() -> Actions<psibase::ActionPacker> {
            psibase::ActionPacker {
                sender: Self::SERVICE,
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            Pack actions into [psibase::Action](psibase::Action).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which pack the action's arguments using [fracpack] and\n            return a [psibase::Action](psibase::Action). The `pack_*` series of\n            functions is mainly useful to applications which push transactions\n            to blockchains.\n\n             This method defaults `sender` to \"chainmail\"."]
        pub fn pack_to(service: psibase::AccountNumber) -> Actions<psibase::ActionPacker> {
            psibase::ActionPacker {
                sender: Self::SERVICE,
                service,
            }
            .into()
        }
        #[doc = "\n            Pack actions into [psibase::Action](psibase::Action).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which pack the action's arguments using [fracpack] and\n            return a [psibase::Action](psibase::Action). The `pack_*` series of\n            functions is mainly useful to applications which push transactions\n            to blockchains.\n\n             This method defaults `service` to \"chainmail\"."]
        pub fn pack_from(sender: psibase::AccountNumber) -> Actions<psibase::ActionPacker> {
            psibase::ActionPacker {
                sender,
                service: Self::SERVICE,
            }
            .into()
        }
        #[doc = "\n            Pack actions into [psibase::Action](psibase::Action).\n\n            This method returns an object which has [methods](Actions#implementations)\n            (one per action) which pack the action's arguments using [fracpack] and\n            return a [psibase::Action](psibase::Action). The `pack_*` series of\n            functions is mainly useful to applications which push transactions\n            to blockchains.\n\n            "]
        pub fn pack_from_to(
            sender: psibase::AccountNumber,
            service: psibase::AccountNumber,
        ) -> Actions<psibase::ActionPacker> {
            psibase::ActionPacker { sender, service }.into()
        }
        #[doc = "\n            Emit events from a service.\n\n            "]
        pub fn emit() -> EmitEvent {
            EmitEvent {
                sender: Self::SERVICE,
            }
        }
        #[doc = "\n            Emit events from a service.\n\n             This method defaults `service` to \"chainmail\"."]
        pub fn emit_from(sender: psibase::AccountNumber) -> EmitEvent {
            EmitEvent { sender }
        }
    }
    impl psibase::ToServiceSchema for Wrapper {
        type Actions = Actions<psibase::JustSchema>;
        type UiEvents = UiEvents;
        type HistoryEvents = HistoryEvents;
        type MerkleEvents = MerkleEvents;
        const SERVICE: psibase::AccountNumber = Self::SERVICE;
    }
    #[automatically_derived]
    pub struct HistoryEvents {
        event_log: psibase::DbId,
        sender: psibase::AccountNumber,
    }
    #[automatically_derived]
    pub struct UiEvents {
        event_log: psibase::DbId,
        sender: psibase::AccountNumber,
    }
    #[automatically_derived]
    pub struct MerkleEvents {
        event_log: psibase::DbId,
        sender: psibase::AccountNumber,
    }
    pub struct EmitEvent {
        sender: psibase::AccountNumber,
    }
    impl psibase::ToEventsSchema for UiEvents {
        fn to_schema(
            _builder: &mut psibase::fracpack::SchemaBuilder,
        ) -> psibase::fracpack::indexmap::IndexMap<psibase::MethodNumber, psibase::fracpack::AnyType>
        {
            Default::default()
        }
    }
    impl psibase::ToEventsSchema for MerkleEvents {
        fn to_schema(
            _builder: &mut psibase::fracpack::SchemaBuilder,
        ) -> psibase::fracpack::indexmap::IndexMap<psibase::MethodNumber, psibase::fracpack::AnyType>
        {
            Default::default()
        }
    }
    impl EmitEvent {
        pub fn history(&self) -> HistoryEvents {
            HistoryEvents {
                event_log: psibase::DbId::HistoryEvent,
                sender: self.sender,
            }
        }
        pub fn ui(&self) -> UiEvents {
            UiEvents {
                event_log: psibase::DbId::UiEvent,
                sender: self.sender,
            }
        }
        pub fn merkle(&self) -> MerkleEvents {
            MerkleEvents {
                event_log: psibase::DbId::MerkleEvent,
                sender: self.sender,
            }
        }
    }
    #[automatically_derived]
    #[allow(non_snake_case)]
    #[allow(non_camel_case_types)]
    #[allow(non_upper_case_globals)]
    impl HistoryEvents {
        #[doc = " History events"]
        pub fn sent(
            &self,
            sender: AccountNumber,
            receiver: AccountNumber,
            subject: String,
            body: String,
            datetime: TimePointSec,
        ) -> u64 {
            psibase::put_sequential(
                self.event_log,
                self.sender,
                &psibase::MethodNumber::new(8440155u64),
                &(sender, receiver, subject, body, datetime),
            )
        }
        pub fn archive(&self, msg_id: String) -> u64 {
            psibase::put_sequential(
                self.event_log,
                self.sender,
                &psibase::MethodNumber::new(34016023u64),
                &(msg_id,),
            )
        }
    }
    #[automatically_derived]
    impl psibase::ToEventsSchema for HistoryEvents {
        fn to_schema(
            builder: &mut psibase::fracpack::SchemaBuilder,
        ) -> psibase::fracpack::indexmap::IndexMap<psibase::MethodNumber, psibase::fracpack::AnyType>
        {
            let mut events = psibase::fracpack::indexmap::IndexMap::new();
            events.insert(
                psibase::MethodNumber::new(8440155u64),
                builder.insert::<event_structs::history::sent>(),
            );
            events.insert(
                psibase::MethodNumber::new(34016023u64),
                builder.insert::<event_structs::history::archive>(),
            );
            events
        }
    }
    #[automatically_derived]
    #[allow(non_snake_case)]
    #[allow(non_camel_case_types)]
    #[allow(non_upper_case_globals)]
    pub mod event_structs {
        pub mod history {
            use super::super::*;
            #[derive(
                Debug,
                Clone,
                psibase::Pack,
                psibase::Unpack,
                psibase::fracpack::ToSchema,
                serde::Deserialize,
                serde::Serialize,
                async_graphql::SimpleObject,
            )]
            #[fracpack(fracpack_mod = "psibase::fracpack")]
            #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::sent](Actions::sent)."]
            pub struct sent {
                pub sender: AccountNumber,
                pub receiver: AccountNumber,
                pub subject: String,
                pub body: String,
                pub datetime: TimePointSec,
            }
            impl sent {
                pub const ACTION_NAME: &'static str = "sent";
            }
            impl psibase::EventDb for sent {
                fn db() -> psibase::DbId {
                    psibase::DbId::HistoryEvent
                }
            }
            impl psibase::NamedEvent for sent {
                fn name() -> psibase::MethodNumber {
                    psibase::MethodNumber::new(8440155u64)
                }
            }
            #[derive(
                Debug,
                Clone,
                psibase::Pack,
                psibase::Unpack,
                psibase::fracpack::ToSchema,
                serde::Deserialize,
                serde::Serialize,
                async_graphql::SimpleObject,
            )]
            #[fracpack(fracpack_mod = "psibase::fracpack")]
            #[doc = "This structure has the same JSON and Fracpack format as the arguments to [Actions::archive](Actions::archive)."]
            pub struct archive {
                pub msg_id: String,
            }
            impl archive {
                pub const ACTION_NAME: &'static str = "archive";
            }
            impl psibase::EventDb for archive {
                fn db() -> psibase::DbId {
                    psibase::DbId::HistoryEvent
                }
            }
            impl psibase::NamedEvent for archive {
                fn name() -> psibase::MethodNumber {
                    psibase::MethodNumber::new(34016023u64)
                }
            }
            #[derive(async_graphql::Union)]
            pub enum HistoryEvents {
                sent(sent),
                archive(archive),
            }
            impl psibase::DecodeEvent for HistoryEvents {
                fn decode(
                    gql_imp_type: psibase::MethodNumber,
                    gql_imp_data: &[u8],
                ) -> Result<HistoryEvents, anyhow::Error> {
                    match gql_imp_type.value {
                        8440155u64 => Ok(HistoryEvents::sent(psibase::decode_event_data::<sent>(
                            gql_imp_data,
                        )?)),
                        34016023u64 => {
                            Ok(HistoryEvents::archive(
                                psibase::decode_event_data::<archive>(gql_imp_data)?,
                            ))
                        }
                        _ => Err(anyhow::__private::must_use({
                            let error = anyhow::__private::format_err(
                                anyhow::__private::format_args!("Unknown event type"),
                            );
                            error
                        })),
                    }
                }
            }
            impl psibase::EventDb for HistoryEvents {
                fn db() -> psibase::DbId {
                    psibase::DbId::HistoryEvent
                }
            }
        }
        pub use history::HistoryEvents;
    }
    #[automatically_derived]
    impl psibase::WithActionStruct for Wrapper {
        fn with_action_struct<P: psibase::ProcessActionStruct>(
            action: &str,
            process: P,
        ) -> Option<P::Output> {
            if action == "init" {
                return Some(process.process::<(), action_structs::init>());
            }
            if action == "send" {
                return Some(process.process::<(), action_structs::send>());
            }
            if action == "archive" {
                return Some(process.process::<(), action_structs::archive>());
            }
            if action == "save" {
                return Some(process.process::<(), action_structs::save>());
            }
            if action == "unsave" {
                return Some(process.process::<(), action_structs::unsave>());
            }
            if action == "serveSys" {
                return Some(process.process::<Option<HttpReply>, action_structs::serveSys>());
            }
            None
        }
    }
}
#[automatically_derived]
pub use service::action_structs;
#[automatically_derived]
pub use service::Actions;
#[automatically_derived]
pub use service::Wrapper;
#[automatically_derived]
pub use service::SERVICE;
#[cfg(all(test, target_family = "wasm"))]
mod psibase_tester_polyfill {
    #![allow(non_snake_case)]
    use psibase::tester_raw;
    use psibase::DbId;
    use tester_raw::get_selected_chain;
    #[no_mangle]
    pub unsafe extern "C" fn getResult(dest: *mut u8, dest_size: u32, offset: u32) -> u32 {
        tester_raw::getResult(dest, dest_size, offset)
    }
    #[no_mangle]
    pub unsafe extern "C" fn getKey(dest: *mut u8, dest_size: u32) -> u32 {
        tester_raw::getKey(dest, dest_size)
    }
    #[no_mangle]
    pub unsafe extern "C" fn writeConsole(message: *const u8, len: u32) {
        {
            std::io::_print(std::format_args!(
                "{}",
                std::str::from_utf8(std::slice::from_raw_parts(message, len as usize)).unwrap()
            ));
        };
    }
    #[no_mangle]
    pub unsafe extern "C" fn abortMessage(message: *const u8, len: u32) -> ! {
        tester_raw::abortMessage(message, len)
    }
    #[no_mangle]
    pub unsafe extern "C" fn kvGet(db: DbId, key: *const u8, key_len: u32) -> u32 {
        tester_raw::kvGet(get_selected_chain(), db, key, key_len)
    }
    #[no_mangle]
    pub unsafe extern "C" fn getSequential(db: DbId, id: u64) -> u32 {
        tester_raw::getSequential(get_selected_chain(), db, id)
    }
    #[no_mangle]
    pub unsafe extern "C" fn kvGreaterEqual(
        db: DbId,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32 {
        tester_raw::kvGreaterEqual(get_selected_chain(), db, key, key_len, match_key_size)
    }
    #[no_mangle]
    pub unsafe extern "C" fn kvLessThan(
        db: DbId,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32 {
        tester_raw::kvLessThan(get_selected_chain(), db, key, key_len, match_key_size)
    }
    #[no_mangle]
    pub unsafe extern "C" fn kvMax(db: DbId, key: *const u8, key_len: u32) -> u32 {
        tester_raw::kvMax(get_selected_chain(), db, key, key_len)
    }
}
