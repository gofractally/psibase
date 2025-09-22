use darling::FromMeta;
use proc_macro2::Span;
use proc_macro_error::emit_error;
use quote::quote;
use syn::{
    parse_quote, AttrStyle, Attribute, Block, Expr, Field, Ident, ImplItem, Item, ItemImpl,
    ItemStruct, Member, ReturnType, Stmt,
};

#[derive(Debug, FromMeta)]
#[darling(default)]
struct TableOptions {
    name: String,
    record: Option<String>,
    index: u16,
    db: String,
}

impl Default for TableOptions {
    fn default() -> Self {
        TableOptions {
            name: "".into(),
            record: None,
            index: 0,
            db: "Service".into(),
        }
    }
}

struct KeySchemaData {
    fields: Vec<Vec<u32>>,
}

impl KeySchemaData {
    fn from_field(index: u32) -> Self {
        KeySchemaData {
            fields: vec![vec![index]],
        }
    }
    fn empty() -> Self {
        KeySchemaData { fields: Vec::new() }
    }
    fn opaque() -> Self {
        // TODO: represent transformation
        KeySchemaData {
            fields: vec![Vec::new()],
        }
    }
    fn schema(&self, psibase_mod: &proc_macro2::TokenStream) -> proc_macro2::TokenStream {
        let mut result = quote! {};
        for field in &self.fields {
            let mut path = quote! {};
            for idx in field {
                path = quote! { #path #idx, }
            }
            result = quote! { #result #psibase_mod::FieldId { path: vec![ #path ], transform: None, type_: None }, }
        }
        quote! { vec![ #result ] }
    }
}

struct PkIdentData {
    ident: Ident,
    ty: proc_macro2::TokenStream,
    call_ident: proc_macro2::TokenStream,
    schema: KeySchemaData,
}

impl PkIdentData {
    fn new(
        ident: Ident,
        ty: proc_macro2::TokenStream,
        call_ident: proc_macro2::TokenStream,
        schema: KeySchemaData,
    ) -> Self {
        Self {
            ident,
            ty,
            call_ident,
            schema,
        }
    }
}

struct SkIdentData {
    ident: Ident,
    idx: u8,
    ty: proc_macro2::TokenStream,
    schema: KeySchemaData,
}

impl SkIdentData {
    fn new(ident: Ident, idx: u8, ty: proc_macro2::TokenStream, schema: KeySchemaData) -> Self {
        Self {
            ident,
            idx,
            ty,
            schema,
        }
    }
}

pub fn is_table_attr(attr: &Attribute) -> bool {
    if let AttrStyle::Outer = attr.style {
        if attr.meta.path().is_ident("table") {
            return true;
        }
    }
    false
}

pub fn process_service_tables(
    psibase_mod: &proc_macro2::TokenStream,
    table_record_struct_name: &Ident,
    items: &mut Vec<Item>,
    table_idxs: &Vec<usize>,
    table_names: &mut Vec<(proc_macro2::TokenStream, proc_macro2::TokenStream)>,
) -> Result<u16, ()> {
    let mut pk_data: Option<PkIdentData> = None;
    let mut secondary_keys = Vec::new();
    let mut table_options: Option<TableOptions> = None;
    let mut table_vis = None;
    let mut preset_table_record: Option<String> = None;

    let mut field_names: Vec<String> = Vec::new();

    for idx in table_idxs {
        match &mut items[*idx] {
            Item::Struct(s) => {
                process_table_attrs(s, &mut table_options)?;
                preset_table_record = table_options
                    .as_ref()
                    .and_then(|opts| opts.record.to_owned());
                if preset_table_record.is_none() {
                    process_table_fields(s, &mut pk_data, &mut field_names)?;
                } else {
                    let fields_named: syn::FieldsNamed =
                        parse_quote! {{ db_id: #psibase_mod::DbId, prefix: Vec<u8> }};
                    s.fields = syn::Fields::Named(fields_named);
                }
                table_vis = Some(s.vis.clone());
                Ok(())
            }
            Item::Impl(i) => {
                process_table_impls(i, &mut pk_data, &mut secondary_keys, &field_names)
            }
            item => {
                emit_error!(item, "Unknown table item to be processed");
                Ok(())
            }
        }?
    }

    if table_options.is_none() {
        emit_error!(table_record_struct_name, "Table name and index not defined");
        return Err(());
    }
    let table_options = table_options.unwrap();

    if pk_data.is_none() && preset_table_record.is_none() {
        emit_error!(
            table_record_struct_name,
            "Table record has not defined a primary key"
        );
        return Err(());
    }

    secondary_keys.sort_by_key(|sk| sk.idx);
    let mut sks_fns = quote! {};
    let mut sks = quote! {};
    let sks_len = secondary_keys.len() as u8;
    for (idx, secondary_key) in secondary_keys.iter().enumerate() {
        let sk_ident = &secondary_key.ident;
        let sk_idx = secondary_key.idx;
        let sk_ty = &secondary_key.ty;

        let expected_idx = idx + 1;
        if sk_idx as usize != expected_idx {
            emit_error!(sk_ident, format!("Missing expected secondary index {}; indexes may not have gaps and may not be removed or reordered", expected_idx));
        }

        sks = quote! { #sks #psibase_mod::RawKey::new(self.#sk_ident().to_key()), };

        let sk_fn_name = Ident::new(&format!("get_index_{}", sk_ident), Span::call_site());

        sks_fns = quote! {
            #sks_fns
            pub fn #sk_fn_name(&self) -> #psibase_mod::TableIndex<#sk_ty, #table_record_struct_name> {
                use #psibase_mod::Table;
                self.get_index(#sk_idx)
            }
        }
    }

    if preset_table_record.is_none() {
        let pk_data = pk_data.unwrap();
        let pk_ty = pk_data.ty;
        let pk_call_ident = pk_data.call_ident;
        let db = Ident::new(&table_options.db, Span::mixed_site());

        let table_record_impl = quote! {
            impl #psibase_mod::TableRecord for #table_record_struct_name {
                type PrimaryKey = #pk_ty;
                const SECONDARY_KEYS: u8 = #sks_len;
                const DB: #psibase_mod::DbId = #psibase_mod::DbId::#db;

                fn get_primary_key(&self) -> #psibase_mod::RawKey {
                    use #psibase_mod::ToKey;
                    #psibase_mod::RawKey::new(self.#pk_call_ident.to_key())
                }

                fn get_secondary_keys(&self) -> Vec<#psibase_mod::RawKey> {
                    use #psibase_mod::ToKey;
                    vec![#sks]
                }
            }
        };

        items.push(parse_quote! {#table_record_impl});

        let pk_schema = pk_data.schema.schema(psibase_mod);
        let mut index_schema = quote! { #pk_schema };

        for sk in &secondary_keys {
            let sk_schema = sk.schema.schema(psibase_mod);
            index_schema = quote! { #index_schema, #sk_schema };
        }

        items.push(parse_quote! {
            impl #psibase_mod::ToIndexSchema for #table_record_struct_name {
                fn to_schema(builder: &mut #psibase_mod::fracpack::SchemaBuilder) -> Vec<#psibase_mod::IndexInfo> {
                    vec![#index_schema]
                }
            }
        });
    }

    let table_index = table_options.index;
    let table_index = quote! { #table_index };

    let (table_name_id, record_name_id) = if let Some(preset_table_record) = preset_table_record {
        (
            table_record_struct_name.clone(),
            Ident::new(
                preset_table_record.as_str(),
                table_record_struct_name.span(),
            ),
        )
    } else {
        let table_name = Ident::new(table_options.name.as_str(), table_record_struct_name.span());
        let table_struct = quote! {
            #table_vis struct #table_name {
                db: #psibase_mod::KvHandle,
                prefix: Vec<u8>,
            }
        };
        items.push(parse_quote! {#table_struct});
        (table_name, table_record_struct_name.clone())
    };

    table_names.push((quote! { #table_name_id }, quote! { #record_name_id }));

    // TODO: This specific naming convention is a bit of a hack. Figure out a way of using an associated type
    let table_record_type_id = Ident::new(
        format!("{}Record", table_name_id).as_str(),
        table_record_struct_name.span(),
    );

    let table_record_type_impl = quote! {
        type #table_record_type_id = #record_name_id;
    };
    items.push(parse_quote! {#table_record_type_impl});

    let table_impl = quote! {
        impl #psibase_mod::Table<#record_name_id> for #table_name_id {
            const TABLE_INDEX: u16 = #table_index;
            const SERVICE: #psibase_mod::AccountNumber = <TablesWrapper as #psibase_mod::ServiceTablesWrapper>::SERVICE;

            fn with_prefix(db_id: #psibase_mod::DbId, prefix: Vec<u8>, mode: #psibase_mod::KvMode) -> Self {
                #table_name_id{db: #psibase_mod::KvHandle::new(db_id, &prefix, mode), prefix: Vec::new()}
            }

            fn prefix(&self) -> &[u8] {
                &self.prefix
            }

            fn handle(&self) -> &#psibase_mod::KvHandle {
                &self.db
            }
        }
    };
    items.push(parse_quote! {#table_impl});

    let table_struct_impl = quote! {
        impl #table_name_id {
            #sks_fns
        }
    };
    items.push(parse_quote! {#table_struct_impl});
    Ok(table_options.index)
}

pub fn process_table_schema_root(
    psibase_mod: &proc_macro2::TokenStream,
    items: &mut Vec<Item>,
    tables: Vec<(proc_macro2::TokenStream, proc_macro2::TokenStream)>,
) {
    let mut schema_init = proc_macro2::TokenStream::new();
    for (table, record) in tables {
        let name = format!("{}", table);
        schema_init = quote! {
            #schema_init
            let table = <#table as #psibase_mod::Table<#record>>::TABLE_INDEX;
            let type_ = <#record as #psibase_mod::fracpack::ToSchema>::schema(builder);
            let indexes = <#record as #psibase_mod::ToIndexSchema>::to_schema(builder);
            let info = #psibase_mod::TableInfo{name: Some(#name.to_string()), table, type_, indexes };
            result.entry(#psibase_mod::db_name(<#record as #psibase_mod::TableRecord>::DB)).or_insert(Vec::new()).push(info);
        }
    }
    items.push(parse_quote! {
        pub struct TablesWrapper;
    });
    items.push(parse_quote! {
        impl #psibase_mod::ToDatabaseSchema for TablesWrapper {
            fn to_schema(builder: &mut #psibase_mod::fracpack::SchemaBuilder) -> Option<#psibase_mod::fracpack::indexmap::IndexMap<String, Vec<#psibase_mod::TableInfo>>> {
                let mut result = #psibase_mod::fracpack::indexmap::IndexMap::new();
                #schema_init
                Some(result)
            }
        }
    });
}

fn process_table_attrs(
    table_struct: &mut ItemStruct,
    table_options: &mut Option<TableOptions>,
) -> Result<(), ()> {
    // Parse table name and remove #[table]
    if let Some(i) = table_struct.attrs.iter().position(is_table_attr) {
        let attr = &table_struct.attrs[i];

        match TableOptions::from_meta(&attr.meta) {
            Ok(options) => {
                *table_options = Some(options);
            }
            Err(err) => {
                emit_error!(attr, format!("Invalid service table attribute, expected `#[table(name = \"TableName\", index = N)]\n{}`", err));
                return Err(());
            }
        };

        // TODO: Think about this sugar attribute #[table(TableName, 1)]
        // *table_name = syn::parse2::<Group>(attr.tokens.clone())
        //     .and_then(|group| syn::parse2::<Ident>(group.stream()))
        //     .map(|ident| quote! {#ident})
        //     .unwrap_or_else(|_| {
        //         abort!(
        //             attr,
        //             "Invalid service table attribute, expected is `#[table(TableName)]`"
        //         )
        //     });

        table_struct.attrs.remove(i);
    }
    Ok(())
}

fn process_table_fields(
    table_record_struct: &mut ItemStruct,
    pk_data: &mut Option<PkIdentData>,
    field_names: &mut Vec<String>,
) -> Result<(), ()> {
    for (field_idx, field) in table_record_struct.fields.iter_mut().enumerate() {
        let mut removable_attr_idxs = Vec::new();

        for (field_attr_idx, field_attr) in field.attrs.iter().enumerate() {
            if field_attr.style == AttrStyle::Outer
                && field_attr.meta.path().is_ident("primary_key")
            {
                process_table_pk_field(pk_data, field, field_idx as u32)?;
                removable_attr_idxs.push(field_attr_idx);
            }
        }

        if let Some(name) = &field.ident {
            field_names.push(name.to_string());
        }

        for i in removable_attr_idxs {
            field.attrs.remove(i);
        }
    }
    Ok(())
}

fn get_field_index(field_names: &Vec<String>, member: &Member) -> Option<u32> {
    return match member {
        Member::Named(ident) => {
            let name = ident.to_string();
            field_names
                .iter()
                .position(|item| item == &name)
                .map(|idx| idx as u32)
        }
        Member::Unnamed(index) => Some(index.index),
    };
}

fn make_key_field(expr: &Expr, field_names: &Vec<String>) -> Vec<u32> {
    let mut names = Vec::new();
    let mut current = expr;
    loop {
        match current {
            Expr::Path(expr) => {
                if expr.path.leading_colon.is_some()
                    || expr.path.segments.len() != 1
                    || expr.path.segments[0].ident.to_string() != "self"
                {
                    emit_error!(expr, "Only fields can be used in keys");
                    return Vec::new();
                }
                break;
            }
            Expr::Field(field) => {
                names.push(&field.member);
                current = &*field.base;
            }
            Expr::MethodCall(call) => {
                if call.args.is_empty() && call.method.to_string() == "clone" {
                    current = &*call.receiver;
                } else {
                    emit_error!(expr, "Only fields can be used in keys");
                    return Vec::new();
                }
            }
            _ => {
                emit_error!(expr, "Only fields can be used in keys");
                return Vec::new();
            }
        }
    }
    names.reverse();
    if names.len() > 1 {
        emit_error!(expr, "Only direct members can be used in keys")
    }
    let mut result = Vec::new();
    if names.len() == 1 {
        if let Some(idx) = get_field_index(field_names, &names[0]) {
            result.push(idx);
        } else {
            emit_error!(&names[0], "Can't find field index");
        }
    }
    result
}

fn append_key_field(expr: &Expr, field_names: &Vec<String>, out: &mut Vec<Vec<u32>>) {
    match expr {
        Expr::Tuple(tuple) => {
            for elem in &tuple.elems {
                append_key_field(elem, field_names, out)
            }
        }
        Expr::Paren(paren) => append_key_field(&*paren.expr, field_names, out),
        Expr::Reference(reference) => append_key_field(&*reference.expr, field_names, out),
        _ => out.push(make_key_field(expr, field_names)),
    }
}

fn process_key_schema(body: &Block, field_names: &Vec<String>) -> KeySchemaData {
    if body.stmts.len() > 1 {
        emit_error!(body, "Key must not contain multiple statements");
        return KeySchemaData::opaque();
    }
    if let Stmt::Expr(expr, None) = &body.stmts[0] {
        let mut result = KeySchemaData { fields: Vec::new() };
        append_key_field(expr, field_names, &mut result.fields);
        result
    } else {
        emit_error!(body, "Key must be a tuple of fields");
        KeySchemaData::opaque()
    }
}

fn process_table_impls(
    table_impl: &mut ItemImpl,
    pk_data: &mut Option<PkIdentData>,
    secondary_keys: &mut Vec<SkIdentData>,
    field_names: &Vec<String>,
) -> Result<(), ()> {
    for impl_item in table_impl.items.iter_mut() {
        if let ImplItem::Fn(method) = impl_item {
            let mut removable_attr_idxs = Vec::new();

            for (attr_idx, attr) in method.attrs.iter().enumerate() {
                if attr.style == AttrStyle::Outer {
                    if attr.meta.path().is_ident("primary_key") {
                        let pk_method = &method.sig.ident;
                        check_unique_pk(pk_data, pk_method)?;

                        if let ReturnType::Type(_, return_type) = &method.sig.output {
                            let pk_type = quote! {#return_type};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(
                                pk_method.clone(),
                                pk_type,
                                pk_call,
                                process_key_schema(&method.block, field_names),
                            ));
                        } else {
                            let pk_type = quote! {()};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(
                                pk_method.clone(),
                                pk_type,
                                pk_call,
                                KeySchemaData::empty(),
                            ));
                        }

                        removable_attr_idxs.push(attr_idx);
                    } else if attr.meta.path().is_ident("secondary_key") {
                        if let Ok(lit) = attr.parse_args::<syn::LitInt>() {
                            if let Ok(idx) = lit.base10_parse::<u8>() {
                                if idx == 0 {
                                    emit_error!(method, "Index 0 is reserved for Primary Key, secondary keys needs to be at least 1");
                                    continue;
                                }

                                if let ReturnType::Type(_, return_type) = &method.sig.output {
                                    let sk_method = &method.sig.ident;
                                    let sk_type = quote! {#return_type};
                                    secondary_keys.push(SkIdentData::new(
                                        sk_method.clone(),
                                        idx,
                                        sk_type,
                                        process_key_schema(&method.block, field_names),
                                    ));
                                } else {
                                    emit_error!(method, "Invalid secondary key return type, make sure it is a valid ToKey.");
                                    continue;
                                }
                            } else {
                                emit_error!(
                                    method,
                                    "Invalid secondary key index number it needs to be a valid u8."
                                );
                                continue;
                            }
                        } else {
                            emit_error!(method, "Unable to parse secondary key index number.");
                            continue;
                        }

                        removable_attr_idxs.push(attr_idx);
                    }
                }
            }

            for i in removable_attr_idxs {
                method.attrs.remove(i);
            }
        }
    }
    Ok(())
}

fn check_unique_pk(pk_data: &Option<PkIdentData>, item_ident: &Ident) -> Result<(), ()> {
    if pk_data.is_some() {
        emit_error!(
            item_ident,
            format!(
                "Primary key already set on {}.",
                pk_data.as_ref().unwrap().ident
            )
        );
        return Err(());
    }
    Ok(())
}

fn process_table_pk_field(
    pk_data: &mut Option<PkIdentData>,
    field: &Field,
    field_idx: u32,
) -> Result<(), ()> {
    let pk_field_ident = field
        .ident
        .as_ref()
        .expect("Attempt to add a Primary key field with no ident");
    check_unique_pk(pk_data, pk_field_ident)?;

    let pk_fn_name = quote! {#pk_field_ident};
    let pk_type = &field.ty;
    let pk_type = quote! {#pk_type};

    *pk_data = Some(PkIdentData::new(
        pk_field_ident.clone(),
        pk_type,
        pk_fn_name,
        KeySchemaData::from_field(field_idx),
    ));
    Ok(())
}
