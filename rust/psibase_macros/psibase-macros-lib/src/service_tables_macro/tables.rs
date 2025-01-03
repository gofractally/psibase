use darling::FromMeta;
use proc_macro2::Span;
use proc_macro_error::abort;
use quote::quote;
use syn::{
    parse_quote, AttrStyle, Attribute, Field, Ident, ImplItem, Item, ItemImpl, ItemStruct,
    ReturnType,
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

struct PkIdentData {
    ident: Ident,
    ty: proc_macro2::TokenStream,
    call_ident: proc_macro2::TokenStream,
}

impl PkIdentData {
    fn new(
        ident: Ident,
        ty: proc_macro2::TokenStream,
        call_ident: proc_macro2::TokenStream,
    ) -> Self {
        Self {
            ident,
            ty,
            call_ident,
        }
    }
}

struct SkIdentData {
    ident: Ident,
    idx: u8,
    ty: proc_macro2::TokenStream,
}

impl SkIdentData {
    fn new(ident: Ident, idx: u8, ty: proc_macro2::TokenStream) -> Self {
        Self { ident, idx, ty }
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
) -> u16 {
    let mut pk_data: Option<PkIdentData> = None;
    let mut secondary_keys = Vec::new();
    let mut table_options: Option<TableOptions> = None;
    let mut table_vis = None;
    let mut preset_table_record: Option<String> = None;
    let mut debug_msgs: Vec<String> = Vec::new();

    debug_msgs.push(String::from("process_service_tables().top"));
    for idx in table_idxs {
        match &mut items[*idx] {
            Item::Struct(s) => {
                process_table_attrs(s, &mut table_options, &mut debug_msgs);
                preset_table_record = table_options
                    .as_ref()
                    .and_then(|opts| opts.record.to_owned());
                if preset_table_record.is_none() {
                    process_table_fields(s, &mut pk_data, &mut debug_msgs);
                } else {
                    let fields_named: syn::FieldsNamed =
                        parse_quote! {{ db_id: #psibase_mod::DbId, prefix: Vec<u8> }};
                    s.fields = syn::Fields::Named(fields_named);
                }
                table_vis = Some(s.vis.clone());
            }
            Item::Impl(i) => {
                process_table_impls(i, &mut pk_data, &mut secondary_keys, &mut debug_msgs)
            }
            item => abort!(item, "Unknown table item to be processed"),
        }
    }

    if table_options.is_none() {
        abort!(table_record_struct_name, "Table name and index not defined");
    }
    let table_options = table_options.unwrap();

    if pk_data.is_none() && preset_table_record.is_none() {
        abort!(
            table_record_struct_name,
            "Table record has not defined a primary key"
        );
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
            abort!(sk_ident, format!("Missing expected secondary index {}; indexes may not have gaps and may not be removed or reordered", expected_idx));
        }

        sks = quote! { #sks #psibase_mod::RawKey::new(self.#sk_ident().to_key()), };

        let sk_fn_name = Ident::new(&format!("get_index_{}", sk_ident), Span::call_site());

        // TODO: why did I need to add the pub on the fn below; it was not originally needed
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

                fn get_primary_key(&self) -> Self::PrimaryKey {
                    self.#pk_call_ident
                }

                fn get_secondary_keys(&self) -> Vec<#psibase_mod::RawKey> {
                    vec![#sks]
                }
            }
        };

        items.push(parse_quote! {#table_record_impl});
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
                db_id: #psibase_mod::DbId,
                prefix: Vec<u8>,
            }
        };
        items.push(parse_quote! {#table_struct});
        (table_name, table_record_struct_name.clone())
    };

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

            fn with_prefix(db_id: #psibase_mod::DbId, prefix: Vec<u8>) -> Self {
                #table_name_id{db_id, prefix}
            }

            fn prefix(&self) -> &[u8] {
                &self.prefix
            }

            fn db_id(&self) -> #psibase_mod::DbId {
                self.db_id
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

    // for (idx, itm) in debug_msgs.iter().enumerate() {
    //     let idnt = Ident::new(&format!("t{}", idx), Span::call_site());
    //     items.push(parse_quote! {
    //         #[doc = #itm]
    //         struct #idnt {}
    //     });
    // }
    let doc_attrs = debug_msgs.into_iter().map(|msg| {
        quote! {
            #[doc = #msg]
        }
    });

    // Combine the struct and its documentation attributes into a single token stream
    let output = parse_quote! {
        #(#doc_attrs)*
        struct macro_debug_msgs {}
    };

    items.push(output);

    table_options.index
}

fn process_table_attrs(
    table_struct: &mut ItemStruct,
    table_options: &mut Option<TableOptions>,
    debug_msgs: &mut Vec<String>,
) {
    debug_msgs.push(String::from("process_table_attrs().top"));
    // Parse table name and remove #[table]
    if let Some(i) = table_struct.attrs.iter().position(is_table_attr) {
        let attr = &table_struct.attrs[i];

        match TableOptions::from_meta(&attr.meta) {
            Ok(options) => {
                *table_options = Some(options);
            }
            Err(err) => {
                abort!(attr, format!("Invalid service table attribute, expected `#[table(name = \"TableName\", index = N)]\n{}`", err));
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
}

fn process_table_fields(
    table_record_struct: &mut ItemStruct,
    pk_data: &mut Option<PkIdentData>,
    debug_msgs: &mut Vec<String>,
) {
    debug_msgs.push(String::from("process_table_fields().top"));
    for field in table_record_struct.fields.iter_mut() {
        let mut removable_attr_idxs = Vec::new();

        for (field_attr_idx, field_attr) in field.attrs.iter().enumerate() {
            debug_msgs.push(String::from(format!(
                "processing attr: {:?}...",
                field_attr.meta
            )));
            if field_attr.style == AttrStyle::Outer {
                if field_attr.meta.path().is_ident("primary_key") {
                    process_table_pk_field(pk_data, field);
                    removable_attr_idxs.push(field_attr_idx);
                }
            }
            // if field_attr.style == AttrStyle::Outer {
            //     if field_attr.meta.path().is_ident("secondary_key") {
            //         // process_table_pk_field(pk_data, field);
            //         removable_attr_idxs.push(field_attr_idx);
            //     }
            // }
        }

        for i in removable_attr_idxs {
            field.attrs.remove(i);
        }
    }
}

fn process_table_impls(
    table_impl: &mut ItemImpl,
    pk_data: &mut Option<PkIdentData>,
    secondary_keys: &mut Vec<SkIdentData>,
    debug_msgs: &mut Vec<String>,
) {
    debug_msgs.push(String::from("process_table_impls().top"));
    for impl_item in table_impl.items.iter_mut() {
        if let ImplItem::Fn(method) = impl_item {
            let mut removable_attr_idxs = Vec::new();

            for (attr_idx, attr) in method.attrs.iter().enumerate() {
                if attr.style == AttrStyle::Outer {
                    debug_msgs.push(String::from(format!("processing outer attr: {:?}", attr)));
                    if attr.meta.path().is_ident("primary_key") {
                        let pk_method = &method.sig.ident;
                        check_unique_pk(pk_data, pk_method);

                        if let ReturnType::Type(_, return_type) = &method.sig.output {
                            let pk_type = quote! {#return_type};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(pk_method.clone(), pk_type, pk_call));
                        } else {
                            let pk_type = quote! {()};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(pk_method.clone(), pk_type, pk_call));
                        }

                        removable_attr_idxs.push(attr_idx);
                    } else if attr.meta.path().is_ident("secondary_key") {
                        if let Ok(lit) = attr.parse_args::<syn::LitInt>() {
                            if let Ok(idx) = lit.base10_parse::<u8>() {
                                if idx == 0 {
                                    abort!(method, "Index 0 is reserved for Primary Key, secondary keys needs to be at least 1");
                                }

                                if let ReturnType::Type(_, return_type) = &method.sig.output {
                                    let sk_method = &method.sig.ident;
                                    let sk_type = quote! {#return_type};
                                    secondary_keys.push(SkIdentData::new(
                                        sk_method.clone(),
                                        idx,
                                        sk_type,
                                    ));
                                } else {
                                    abort!(impl_item, "Invalid secondary key return type, make sure it is a valid ToKey.");
                                }
                            } else {
                                abort!(
                                    method,
                                    "Invalid secondary key index number it needs to be a valid u8."
                                );
                            }
                        } else {
                            abort!(method, "Unable to parse secondary key index number.");
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
}

fn check_unique_pk(pk_data: &Option<PkIdentData>, item_ident: &Ident) {
    if pk_data.is_some() {
        abort!(
            item_ident,
            format!(
                "Primary key already set on {}.",
                pk_data.as_ref().unwrap().ident
            )
        )
    }
}

fn process_table_pk_field(pk_data: &mut Option<PkIdentData>, field: &Field) {
    let pk_field_ident = field
        .ident
        .as_ref()
        .expect("Attempt to add a Primary key field with no ident");
    check_unique_pk(pk_data, pk_field_ident);

    let pk_fn_name = quote! {#pk_field_ident};
    let pk_type = &field.ty;
    let pk_type = quote! {#pk_type};

    *pk_data = Some(PkIdentData::new(
        pk_field_ident.clone(),
        pk_type,
        pk_fn_name,
    ));
}
