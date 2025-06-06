mod tables;

use darling::{ast::NestedMeta, Error, FromMeta};
use proc_macro2::TokenStream;
use proc_macro_error::{abort, emit_error};
use quote::quote;
use std::{collections::HashMap, str::FromStr};
use syn::{Ident, Item, ItemMod, Type};
use tables::{is_table_attr, process_service_tables, process_table_schema_root};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    pub psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            psibase_mod: "psibase".into(),
        }
    }
}

pub fn service_tables_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr_args = match NestedMeta::parse_meta_list(attr) {
        Ok(v) => v,
        Err(e) => {
            return TokenStream::from(Error::from(e).write_errors());
        }
    };
    let options: Options = match Options::from_list(&attr_args) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let psibase_mod = proc_macro2::TokenStream::from_str(&options.psibase_mod).unwrap();

    let item = syn::parse2::<syn::Item>(item).unwrap();
    match item {
        Item::Mod(mut impl_mod) => {
            process_mod(&psibase_mod, &mut impl_mod);
            quote! { #impl_mod }.into()
        }
        _ => {
            abort!(
                item,
                "service_tables attribute may only be used on a module"
            )
        }
    }
}

pub(crate) fn process_mod(psibase_mod: &proc_macro2::TokenStream, impl_mod: &mut ItemMod) {
    if let Some((_, items)) = &mut impl_mod.content {
        let mut table_structs: HashMap<Ident, Vec<usize>> = HashMap::new();
        let mut table_names = Vec::new();

        // collect all tables
        for (item_index, item) in items.iter_mut().enumerate() {
            if let Item::Struct(s) = item {
                if s.attrs.iter().any(is_table_attr) {
                    table_structs.insert(s.ident.clone(), vec![item_index]);
                }
            }
        }

        // do second table loop in case the code has `impl` for a relevant table above the struct definition
        for (item_index, item) in items.iter().enumerate() {
            if let Item::Impl(i) = item {
                if let Type::Path(type_path) = &*i.self_ty {
                    if let Some(tpps) = type_path.path.segments.first() {
                        table_structs.entry(tpps.ident.clone()).and_modify(|refs| {
                            refs.push(item_index);
                        });
                    }
                }
            }
        }

        // Transform table attributes into expanded code
        let mut processed_tables = Vec::new();
        for (tb_name, items_idxs) in table_structs.iter() {
            let table_idx =
                process_service_tables(psibase_mod, tb_name, items, items_idxs, &mut table_names);
            if table_idx.is_ok() {
                processed_tables.push((tb_name, table_idx.unwrap()));
            }
        }

        process_table_schema_root(psibase_mod, items, table_names);

        // Validate table indexes
        processed_tables.sort_by_key(|t| t.1);
        for (expected_idx, (table_struct, tb_index)) in processed_tables.iter().enumerate() {
            if *tb_index as usize != expected_idx {
                emit_error!(
                    table_struct,
                    format!("Missing expected table index {}; tables may not have gaps and may not be removed or reordered.", expected_idx)
                );
            }
        }
    } else {
        emit_error!(
            impl_mod,
            "#[psibase::service_tables] module must have inline contents"
        )
    }
} // process_mod
