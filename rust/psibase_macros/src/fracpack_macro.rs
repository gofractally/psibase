use darling::FromDeriveInput;
use proc_macro::TokenStream;
use quote::quote;
use syn::{
    parse_macro_input, Data, DataEnum, DataStruct, DeriveInput, Fields, FieldsNamed, FieldsUnnamed,
};

/// Fracpack struct level options
#[derive(Debug, Default, FromDeriveInput)]
#[darling(default, attributes(fracpack))]
pub struct Options {
    definition_will_not_change: bool,
}

struct StructField<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
}

struct EnumField<'a> {
    name: &'a proc_macro2::Ident,
    as_type: proc_macro2::TokenStream,
    selector: proc_macro2::TokenStream,
    pack: proc_macro2::TokenStream,
    unpack: proc_macro2::TokenStream,
}

fn struct_fields(data: &DataStruct) -> Vec<StructField> {
    match &data.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|field| StructField {
                name: field.ident.as_ref().unwrap(),
                ty: &field.ty,
            })
            .collect(),
        Fields::Unnamed(_) => unimplemented!("fracpack does not support unnamed fields"),
        Fields::Unit => unimplemented!("fracpack does not support unit struct"),
    }
}

fn enum_named<'a>(
    frackpack_mod: &proc_macro2::TokenStream,
    enum_name: &proc_macro2::Ident,
    field_name: &'a proc_macro2::Ident,
    field: &FieldsNamed,
) -> EnumField<'a> {
    let as_type = {
        let types = field
            .named
            .iter()
            .map(|x| {
                let ty = &x.ty;
                quote! {#ty}
            })
            .reduce(|acc, new| quote! {#acc,#new})
            .unwrap_or_default();
        quote! {(#types,)}
    };
    let as_tuple_of_ref = {
        let types = field
            .named
            .iter()
            .map(|x| {
                let ty = &x.ty;
                quote! {&#ty}
            })
            .reduce(|acc, new| quote! {#acc,#new})
            .unwrap_or_default();
        quote! {(#types,)}
    };

    EnumField {
        name: field_name,
        as_type: as_type.clone(),
        selector: {
            let numbered = field
                .named
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    let f = &f.ident;
                    let n =
                        syn::Ident::new(&format!("field_{}", i), proc_macro2::Span::call_site());
                    quote! {#f:#n,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {{#numbered}}
        },
        pack: {
            let numbered = field
                .named
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    let f =
                        syn::Ident::new(&format!("field_{}", i), proc_macro2::Span::call_site());
                    quote! {#f,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {<#as_tuple_of_ref as #frackpack_mod::TupleOfRefPackable>::pack_tuple_of_ref(&(#numbered), dest)}
        },
        unpack: {
            let init = field
                .named
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    let i = syn::Index::from(i);
                    let f = &f.ident;
                    quote! {#f: data.#i,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {
                {
                    let data = <#as_type as #frackpack_mod::Packable>::unpack(src, pos)?;
                    #enum_name::#field_name{#init}
                }
            }
        },
    }
}

fn enum_single<'a>(
    frackpack_mod: &proc_macro2::TokenStream,
    enum_name: &proc_macro2::Ident,
    field_name: &'a proc_macro2::Ident,
    field: &FieldsUnnamed,
) -> EnumField<'a> {
    let ty = &field.unnamed[0].ty;
    EnumField {
        name: field_name,
        as_type: {
            quote! {#ty}
        },
        selector: quote! {(field_0)},
        pack: quote! {<#ty as #frackpack_mod::Packable>::pack(field_0, dest)},
        unpack: quote! {
            #enum_name::#field_name(<#ty as #frackpack_mod::Packable>::unpack(src, pos)?)
        },
    }
}

fn enum_tuple<'a>(
    frackpack_mod: &proc_macro2::TokenStream,
    enum_name: &proc_macro2::Ident,
    field_name: &'a proc_macro2::Ident,
    field: &FieldsUnnamed,
) -> EnumField<'a> {
    let as_type = {
        let types = field
            .unnamed
            .iter()
            .map(|x| {
                let ty = &x.ty;
                quote! {#ty,}
            })
            .fold(quote! {}, |acc, new| quote! {#acc #new});
        quote! {(#types)}
    };
    let as_tuple_of_ref = {
        let types = field
            .unnamed
            .iter()
            .map(|x| {
                let ty = &x.ty;
                quote! {&#ty,}
            })
            .fold(quote! {}, |acc, new| quote! {#acc #new});
        quote! {(#types)}
    };

    EnumField {
        name: field_name,
        as_type: as_type.clone(),
        selector: {
            let numbered = field
                .unnamed
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    let f =
                        syn::Ident::new(&format!("field_{}", i), proc_macro2::Span::call_site());
                    quote! {#f,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {(#numbered)}
        },
        pack: {
            let numbered = field
                .unnamed
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    let f =
                        syn::Ident::new(&format!("field_{}", i), proc_macro2::Span::call_site());
                    quote! {#f,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {<#as_tuple_of_ref as #frackpack_mod::TupleOfRefPackable>::pack_tuple_of_ref(&(#numbered), dest)}
        },
        unpack: {
            let numbered = field
                .unnamed
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    let i = syn::Index::from(i);
                    quote! {data.#i,}
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {
                {
                    let data = <#as_type as #frackpack_mod::Packable>::unpack(src, pos)?;
                    #enum_name::#field_name(#numbered)
                }
            }
        },
    }
}

fn enum_fields<'a>(
    frackpack_mod: &proc_macro2::TokenStream,
    enum_name: &proc_macro2::Ident,
    data: &'a DataEnum,
) -> Vec<EnumField<'a>> {
    data.variants
        .iter()
        .map(|var| {
            let field_name = &var.ident;

            match &var.fields {
                Fields::Named(field) => enum_named(frackpack_mod, enum_name, field_name, field),

                Fields::Unnamed(field) => {
                    if field.unnamed.len() == 1 {
                        enum_single(frackpack_mod, enum_name, field_name, field)
                    } else {
                        enum_tuple(frackpack_mod, enum_name, field_name, field)
                    }
                }
                Fields::Unit => unimplemented!("variants must have fields"), // TODO
            }
        })
        .collect()
}

pub fn fracpack_macro_impl(
    frackpack_mod: &proc_macro2::TokenStream,
    input: TokenStream,
) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    // parse fracpack macro options
    let opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };

    match &input.data {
        Data::Struct(data) => process_struct(frackpack_mod, &input, data, &opts),
        Data::Enum(data) => process_enum(frackpack_mod, &input, data),
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
fn process_struct(
    frackpack_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    data: &DataStruct,
    opts: &Options,
) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = struct_fields(data);
    let fixed_size = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! {<#ty as #frackpack_mod::Packable>::FIXED_SIZE}
        })
        .fold(quote! {0}, |acc, new| quote! {#acc + #new});
    let use_heap = if !opts.definition_will_not_change {
        quote! {true}
    } else {
        fields
            .iter()
            .map(|field| {
                let ty = &field.ty;
                quote! {<#ty as #frackpack_mod::Packable>::VARIABLE_SIZE}
            })
            .fold(quote! {false}, |acc, new| quote! {#acc || #new})
    };
    let positions: Vec<syn::Ident> = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            let concatenated = format!("pos_{}", name);
            syn::Ident::new(&concatenated, name.span())
        })
        .collect();
    let pack_heap = if !opts.definition_will_not_change {
        quote! { <u16 as #frackpack_mod::Packable>::pack(&(heap as u16), dest); }
    } else {
        quote! {}
    };
    let unpack_heap_size = if !opts.definition_will_not_change {
        quote! { let heap_size = <u16 as #frackpack_mod::Packable>::unpack(src, pos)?; }
    } else {
        quote! { let heap_size = #fixed_size; }
    };
    let pack_fixed_members = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let ty = &field.ty;
            let pos = &positions[i];
            quote! {
                let #pos = dest.len() as u32;
                <#ty as #frackpack_mod::Packable>::embedded_fixed_pack(&self.#name, dest);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let pack_variable_members = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let ty = &field.ty;
            let pos = &positions[i];
            quote! {
                <#ty as #frackpack_mod::Packable>::embedded_fixed_repack(&self.#name, #pos, dest.len() as u32, dest);
                <#ty as #frackpack_mod::Packable>::embedded_variable_pack(&self.#name, dest);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            let ty = &field.ty;
            quote! {
                #name: <#ty as #frackpack_mod::Packable>::embedded_unpack(src, pos, &mut heap_pos)?,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    // TODO: skip unknown members
    // TODO: option to verify no unknown members
    let verify = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! { <#ty as #frackpack_mod::Packable>::embedded_verify(src, pos, &mut heap_pos)?; }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl<'a> #frackpack_mod::Packable<'a> for #name #generics {
            const VARIABLE_SIZE: bool = #use_heap;
            const FIXED_SIZE: u32 = if Self::VARIABLE_SIZE { 4 } else { #fixed_size };
            fn pack(&self, dest: &mut Vec<u8>) {
                let heap = #fixed_size;
                assert!(heap as u16 as u32 == heap); // TODO: return error
                #pack_heap
                #pack_fixed_members
                #pack_variable_members
            }
            fn unpack(src: &'a [u8], pos: &mut u32) -> #frackpack_mod::Result<Self> {
                #unpack_heap_size
                let mut heap_pos = *pos + heap_size as u32;
                if heap_pos < *pos {
                    return Err(#frackpack_mod::Error::BadOffset);
                }
                let result = Self {
                    #unpack
                };
                *pos = heap_pos;
                Ok(result)
            }
            fn verify(src: &'a [u8], pos: &mut u32) -> #frackpack_mod::Result<()> {
                #unpack_heap_size
                let mut heap_pos = *pos + heap_size as u32;
                if heap_pos < *pos {
                    return Err(#frackpack_mod::Error::BadOffset);
                }
                #verify
                *pos = heap_pos;
                Ok(())
            }
        }
    })
} // process_struct

fn process_enum(
    frackpack_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    data: &DataEnum,
) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = enum_fields(frackpack_mod, name, data);
    // TODO: 128? also check during verify and unpack
    assert!(fields.len() < 256);
    let pack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let field_name = &field.name;
            let selector = &field.selector;
            let pack = &field.pack;
            quote! {#name::#field_name #selector => {
                dest.push(#index);
                size_pos = dest.len();
                dest.extend_from_slice(&0_u32.to_le_bytes());
                #pack;
            }}
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let unpack = &field.unpack;
            quote! {
                #index => #unpack,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let verify_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let as_type = &field.as_type;
            quote! {
                #index => <#as_type as #frackpack_mod::Packable>::verify(src, pos)?,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl<'a> #frackpack_mod::Packable<'a> for #name #generics {
            const FIXED_SIZE: u32 = 4;
            const VARIABLE_SIZE: bool = true;
            fn pack(&self, dest: &mut Vec<u8>) {
                let size_pos;
                match &self {
                    #pack_items
                };
                let size = (dest.len() - size_pos - 4) as u32;
                dest[size_pos..size_pos + 4].copy_from_slice(&size.to_le_bytes());
            }
            fn unpack(src: &'a [u8], pos: &mut u32) -> #frackpack_mod::Result<Self> {
                let index = <u8 as #frackpack_mod::Packable>::unpack(src, pos)?;
                let size_pos = *pos;
                let size = <u32 as #frackpack_mod::Packable>::unpack(src, pos)?;
                let result = match index {
                    #unpack_items
                    _ => return Err(#frackpack_mod::Error::BadEnumIndex),
                };
                if *pos != size_pos + 4 + size {
                    return Err(#frackpack_mod::Error::BadSize);
                }
                Ok(result)
            }
            // TODO: option to error on unknown index
            fn verify(src: &'a [u8], pos: &mut u32) -> #frackpack_mod::Result<()> {
                let index = <u8 as #frackpack_mod::Packable>::unpack(src, pos)?;
                let size_pos = *pos;
                let size = <u32 as #frackpack_mod::Packable>::unpack(src, pos)?;
                match index {
                    #verify_items
                    _ => {
                        *pos = size_pos + 4 + size;
                        return Ok(());
                    }
                }
                if *pos != size_pos + 4 + size {
                    return Err(#frackpack_mod::Error::BadSize);
                }
                Ok(())
            }
        }
    })
} // process_enum
