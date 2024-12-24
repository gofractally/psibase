mod tables;

use proc_macro2::TokenStream;
use proc_macro_error::abort;
use quote::quote;
use std::{collections::HashMap, str::FromStr};
use syn::{Ident, Item, ItemMod, Type};
use tables::{is_table_attr, process_service_tables};

pub fn state_macro_impl(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let options_psibase_mod = String::from("psibase");

    let psibase_mod = proc_macro2::TokenStream::from_str(&options_psibase_mod).unwrap();
    let item = syn::parse2::<syn::Item>(item).unwrap();
    match item {
        Item::Mod(impl_mod) => process_mod(&psibase_mod, impl_mod),
        _ => {
            abort!(item, "service attribute may only be used on a module")
        }
    }
}

fn process_mod(psibase_mod: &proc_macro2::TokenStream, mut impl_mod: ItemMod) -> TokenStream {
    if let Some((_, items)) = &mut impl_mod.content {
        let mut table_structs: HashMap<Ident, Vec<usize>> = HashMap::new();

        for (item_index, item) in items.iter_mut().enumerate() {
            if let Item::Struct(s) = item {
                if s.attrs.iter().any(is_table_attr) {
                    table_structs.insert(s.ident.clone(), vec![item_index]);
                }
            }
        }

        // A second loop is needed in case the code has `impl` for a relevant table above the struct definition
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

        let mut processed_tables = Vec::new();
        for (tb_name, items_idxs) in table_structs.iter() {
            let table_idx = process_service_tables(psibase_mod, tb_name, items, items_idxs);
            processed_tables.push((tb_name, table_idx));
        }

        // Validates table indexes
        processed_tables.sort_by_key(|t| t.1);
        // for (expected_idx, (table_struct, tb_index)) in processed_tables.iter().enumerate() {
        //     if *tb_index as usize != expected_idx {
        //         abort!(
        //             table_struct,
        //             format!("Missing expected table index {}; tables may not have gaps and may not be removed or reordered.", expected_idx)
        //         );
        //     }
        // }

        // items.push(parse_quote! {
        //     #[doc = "mikey2"]
        //     struct test_string1 {}
        // });
    } else {
        abort!(
            impl_mod,
            "#[psibase::service] module must have inline contents"
        )
    }
    quote! {
        #impl_mod
    }
    .into()
} // process_mod
