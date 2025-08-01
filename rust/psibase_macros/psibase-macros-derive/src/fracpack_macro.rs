use darling::{FromDeriveInput, FromField, FromVariant};
use proc_macro::TokenStream;
use quote::quote;
use std::str::FromStr;
use syn::{
    parse_macro_input, Data, DataEnum, DataStruct, DeriveInput, Field, Fields, FieldsNamed,
    FieldsUnnamed, LitStr,
};

/// Fracpack struct level options
#[derive(Debug, FromDeriveInput, FromVariant)]
#[darling(default, attributes(fracpack))]
pub(crate) struct Options {
    pub(crate) definition_will_not_change: bool,
    pub(crate) fracpack_mod: String,
    pub(crate) custom: Option<LitStr>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            definition_will_not_change: false,
            fracpack_mod: "psibase::fracpack".into(),
            custom: None,
        }
    }
}

/// Fracpack field level options
#[derive(Debug, Default, FromField)]
#[darling(default, attributes(fracpack))]
pub(crate) struct FieldOptions {
    pub(crate) skip: bool,
}

struct StructField<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
    skip: bool,
}

struct EnumField<'a> {
    name: &'a proc_macro2::Ident,
    as_type: proc_macro2::TokenStream,
    selector: proc_macro2::TokenStream,
    pack: proc_macro2::TokenStream,
    unpack: proc_macro2::TokenStream,
}

pub(crate) fn skip_field(field: &Field) -> bool {
    FieldOptions::from_field(field).map_or(false, |attr| attr.skip)
}

fn use_field(field: &&StructField) -> bool {
    !field.skip
}

fn struct_fields(data: &DataStruct) -> Vec<StructField> {
    match &data.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|field| StructField {
                name: field.ident.as_ref().unwrap(),
                ty: &field.ty,
                skip: skip_field(field),
            })
            .collect(),
        Fields::Unnamed(_) => unimplemented!(),
        Fields::Unit => unimplemented!("fracpack does not support unit struct"),
    }
}

fn enum_named<'a>(
    fracpack_mod: &proc_macro2::TokenStream,
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
            quote! {<#as_tuple_of_ref as #fracpack_mod::Pack>::pack(&(#numbered), dest)}
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
                    let data = <#as_type as #fracpack_mod::Unpack>::unpack(src)?;
                    #enum_name::#field_name{#init}
                }
            }
        },
    }
}

fn enum_single<'a>(
    fracpack_mod: &proc_macro2::TokenStream,
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
        pack: quote! {<#ty as #fracpack_mod::Pack>::pack(field_0, dest)},
        unpack: quote! {
            #enum_name::#field_name(<#ty as #fracpack_mod::Unpack>::unpack(src)?)
        },
    }
}

fn enum_tuple<'a>(
    fracpack_mod: &proc_macro2::TokenStream,
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
            quote! {<#as_tuple_of_ref as #fracpack_mod::Pack>::pack(&(#numbered), dest)}
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
                    let data = <#as_type as #fracpack_mod::Unpack>::unpack(src)?;
                    #enum_name::#field_name(#numbered)
                }
            }
        },
    }
}

fn enum_fields<'a>(
    fracpack_mod: &proc_macro2::TokenStream,
    enum_name: &proc_macro2::Ident,
    data: &'a DataEnum,
) -> Vec<EnumField<'a>> {
    data.variants
        .iter()
        .map(|var| {
            let field_name = &var.ident;

            match &var.fields {
                Fields::Named(field) => enum_named(fracpack_mod, enum_name, field_name, field),

                Fields::Unnamed(field) => {
                    if field.unnamed.len() == 1 {
                        enum_single(fracpack_mod, enum_name, field_name, field)
                    } else {
                        enum_tuple(fracpack_mod, enum_name, field_name, field)
                    }
                }
                Fields::Unit => unimplemented!("variants must have fields"), // TODO
            }
        })
        .collect()
}

pub fn fracpack_macro_impl(input: TokenStream, impl_pack: bool, impl_unpack: bool) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    let opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let fracpack_mod = proc_macro2::TokenStream::from_str(&opts.fracpack_mod).unwrap();

    match &input.data {
        Data::Struct(data) => {
            process_struct(&fracpack_mod, &input, impl_pack, impl_unpack, data, &opts)
        }
        Data::Enum(data) => process_enum(&fracpack_mod, &input, impl_pack, impl_unpack, data),
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
fn process_struct(
    fracpack_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    impl_pack: bool,
    impl_unpack: bool,
    data: &DataStruct,
    opts: &Options,
) -> TokenStream {
    if let Fields::Unnamed(unnamed) = &data.fields {
        return process_struct_unnamed(fracpack_mod, input, impl_pack, impl_unpack, unnamed, opts);
    }
    let name = &input.ident;
    let generics = &input.generics;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let fields = struct_fields(data);

    let optional_fields = fields.iter().filter(use_field).map(|field| {
        let ty = &field.ty;
        quote! {<#ty as #fracpack_mod::Pack>::IS_OPTIONAL}
    });

    let check_optional_fields = fields.iter().filter(use_field).map(|field| {
        let name = &field.name;
        let ty = &field.ty;
        if opts.definition_will_not_change {
            quote! {true}
        } else {
            quote! {!<#ty as #fracpack_mod::Pack>::is_empty_optional(&self.#name)}
        }
    });

    let use_heap = if !opts.definition_will_not_change {
        quote! {true}
    } else {
        fields
            .iter()
            .filter(use_field)
            .map(|field| {
                let ty = &field.ty;
                quote! {<#ty as #fracpack_mod::Pack>::VARIABLE_SIZE}
            })
            .fold(quote! {false}, |acc, new| quote! {#acc || #new})
    };

    let fixed_size = fields
        .iter()
        .filter(use_field)
        .map(|field| {
            let ty = &field.ty;
            quote! {<#ty as #fracpack_mod::Pack>::FIXED_SIZE}
        })
        .fold(quote! {0}, |acc, new| quote! {#acc + #new});

    let fixed_data_size = fields
        .iter()
        .filter(use_field)
        .enumerate()
        .map(|(i, field)| {
            let ty = &field.ty;
            quote! { if trailing_empty_index > #i { <#ty as #fracpack_mod::Pack>::FIXED_SIZE } else { 0 } }
        })
        .fold(quote! {0}, |acc, new| quote! {#acc + #new});

    let positions: Vec<syn::Ident> = fields
        .iter()
        .filter(use_field)
        .map(|field| {
            let name = &field.name;
            let concatenated = format!("pos_{}", name);
            syn::Ident::new(&concatenated, name.span())
        })
        .collect();
    let pack_heap = if !opts.definition_will_not_change {
        quote! { <u16 as #fracpack_mod::Pack>::pack(&(heap as u16), dest); }
    } else {
        quote! {}
    };
    let unpack_heap_size = if !opts.definition_will_not_change {
        quote! {
            let fixed_size = <u16 as #fracpack_mod::Unpack>::unpack(src)?;
            let mut last_empty = false;
        }
    } else {
        quote! { let fixed_size = #fixed_size; }
    };

    let pack_fixed_members = fields
        .iter()
        .filter(use_field)
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let ty = &field.ty;
            let pos = &positions[i];
            let pos_quote = quote! {
                #[allow(non_snake_case)]
                let #pos = dest.len() as u32;
            };
            quote! {
                #pos_quote
                if trailing_empty_index > #i {
                    <#ty as #fracpack_mod::Pack>::embedded_fixed_pack(&self.#name, dest);
                }
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let pack_variable_members = fields
        .iter()
        .filter(use_field)
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let ty = &field.ty;
            let pos = &positions[i];
            quote! {
                if trailing_empty_index > #i {
                    <#ty as #fracpack_mod::Pack>::embedded_fixed_repack(&self.#name, #pos, dest.len() as u32, dest);
                    <#ty as #fracpack_mod::Pack>::embedded_variable_pack(&self.#name, dest);
                }
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let unpack = fields
        .iter()
        .filter(use_field)
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let ty = &field.ty;
            if !opts.definition_will_not_change {
                quote! {
                    let #name = if #i < trailing_optional_index || fixed_pos < heap_pos {
                        last_empty = <#ty as #fracpack_mod::Unpack>::is_empty_optional(src, &mut fixed_pos.clone())?;
                        <#ty as #fracpack_mod::Unpack>::embedded_unpack(src, &mut fixed_pos)?
                    } else {
                        <#ty as #fracpack_mod::Unpack>::new_empty_optional()?
                    };
                }
            } else {
                quote! {
                    let #name = <#ty as #fracpack_mod::Unpack>::embedded_unpack(src, &mut fixed_pos)?;
                }
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let field_names_assignment = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            if field.skip {
                quote! { #name: Default::default(), }
            } else {
                quote! {
                    #name,
                }
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    // TODO: skip unknown members
    // TODO: option to verify no unknown members
    let verify = fields
        .iter()
        .filter(use_field)
        .enumerate()
        .map(|(i, field)| {
            let ty = &field.ty;
            // let name = &field.name;
            if !opts.definition_will_not_change {
                quote! {
                    if #i < trailing_optional_index || fixed_pos < heap_pos as u32 {
                        last_empty = <#ty as #fracpack_mod::Unpack>::is_empty_optional(src, &mut fixed_pos.clone())?;
                        <#ty as #fracpack_mod::Unpack>::embedded_verify(src, &mut fixed_pos)?;
                    }
                }
            } else {
                quote! {
                    <#ty as #fracpack_mod::Unpack>::embedded_verify(src, &mut fixed_pos)?;
                }
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let pack_impl = if impl_pack {
        quote! {
            impl #impl_generics #fracpack_mod::Pack for #name #ty_generics #where_clause {
                const VARIABLE_SIZE: bool = #use_heap;
                const FIXED_SIZE: u32 =
                    if <Self as #fracpack_mod::Pack>::VARIABLE_SIZE { 4 } else { #fixed_size };
                fn pack(&self, dest: &mut Vec<u8>) {
                    let non_empty_fields = vec![
                        #(#check_optional_fields),*
                    ];
                    let trailing_empty_index = non_empty_fields.iter().rposition(|&is_non_empty| is_non_empty).map_or(0, |idx| idx + 1);

                    let heap = #fixed_data_size;
                    assert!(heap as u16 as u32 == heap); // TODO: return error


                    #pack_heap
                    #pack_fixed_members
                    #pack_variable_members
                }
            }
        }
    } else {
        quote! {}
    };

    let unpack_last_non_optional_index = quote! {
        let optional_fields: Vec<bool> = vec![
            #(#optional_fields),*
        ];
        let trailing_optional_index = optional_fields.iter().rposition(|&is_optional| !is_optional).map_or(0, |idx| idx + 1);
    };

    let unpack_impl = if impl_unpack {
        let end_object = if !opts.definition_will_not_change {
            quote! {
                src.consume_trailing_optional(fixed_pos, heap_pos, last_empty)?;
            }
        } else {
            quote! {}
        };
        quote! {
            impl<'a> #fracpack_mod::Unpack<'a> for #name #generics {
                const VARIABLE_SIZE: bool = #use_heap;
                const FIXED_SIZE: u32 =
                    if <Self as #fracpack_mod::Unpack>::VARIABLE_SIZE { 4 } else { #fixed_size };
                fn unpack(src: &mut #fracpack_mod::FracInputStream<'a>) -> #fracpack_mod::Result<Self> {
                    #unpack_heap_size

                    #unpack_last_non_optional_index

                    let mut fixed_pos = src.advance(fixed_size as u32)?;
                    let heap_pos = src.pos;
                    #unpack
                    #end_object
                    let result = Self {
                        #field_names_assignment
                    };
                    Ok(result)
                }
                fn verify(src: &mut #fracpack_mod::FracInputStream) -> #fracpack_mod::Result<()> {
                    #unpack_heap_size

                    #unpack_last_non_optional_index

                    let mut fixed_pos = src.advance(fixed_size as u32)?;
                    let heap_pos = src.pos;
                    #verify
                    #end_object

                    Ok(())
                }
            }
        }
    } else {
        quote! {}
    };

    TokenStream::from(quote! {
        #pack_impl
        #unpack_impl
    })
} // process_struct

fn process_struct_unnamed(
    fracpack_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    impl_pack: bool,
    impl_unpack: bool,
    unnamed: &FieldsUnnamed,
    opts: &Options,
) -> TokenStream {
    if opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs with named fields")
    }
    let name = &input.ident;
    let generics = &input.generics;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    let ty = if unnamed.unnamed.len() == 1 {
        let ty = &unnamed.unnamed[0].ty;
        quote! {#ty}
    } else {
        let ty = unnamed.unnamed.iter().fold(quote! {}, |acc, a| {
            let ty = &a.ty;
            quote! {#acc #ty,}
        });
        quote! {(#ty)}
    };
    let ty = quote! {<#ty as #fracpack_mod::Unpack>};

    let ref_ty = if unnamed.unnamed.len() == 1 {
        let ty = &unnamed.unnamed[0].ty;
        quote! {&#ty}
    } else {
        let ty = unnamed.unnamed.iter().fold(quote! {}, |acc, a| {
            let ty = &a.ty;
            quote! {#acc &#ty,}
        });
        quote! {(#ty)}
    };
    let ref_ty = quote! {<#ref_ty as #fracpack_mod::Pack>};

    let to_value = if unnamed.unnamed.len() == 1 {
        quote! {let value = &self.0;}
    } else {
        let to_value = unnamed
            .unnamed
            .iter()
            .enumerate()
            .fold(quote! {}, |acc, (i, _)| {
                let i = syn::Index::from(i);
                quote! {#acc &self.#i,}
            });
        quote! {let value = (#to_value);}
    };

    let from_value = if unnamed.unnamed.len() == 1 {
        quote! {Self(value)}
    } else {
        let from_value = unnamed
            .unnamed
            .iter()
            .enumerate()
            .fold(quote! {}, |acc, (i, _)| {
                let i = syn::Index::from(i);
                quote! {#acc value.#i,}
            });
        quote! {Self(#from_value)}
    };

    let (is_empty_container, new_empty_container) = if unnamed.unnamed.len() == 1 {
        (
            quote! {
                fn is_empty_container(&self) -> bool {
                    self.0.is_empty_container()
                }
            },
            quote! {
                fn new_empty_container() -> #fracpack_mod::Result<Self> {
                    Ok(Self(#ty::new_empty_container()?))
                }
                fn new_empty_optional() -> #fracpack_mod::Result<Self> {
                    Ok(Self(#ty::new_empty_optional()?))
                }
            },
        )
    } else {
        (quote! {}, quote! {})
    };

    let pack_impl = if impl_pack {
        quote! {
            impl #impl_generics #fracpack_mod::Pack for #name #ty_generics #where_clause {
                const FIXED_SIZE: u32 = #ty::FIXED_SIZE;
                const VARIABLE_SIZE: bool = #ty::VARIABLE_SIZE;
                const IS_OPTIONAL: bool = #ty::IS_OPTIONAL;

                fn pack(&self, dest: &mut Vec<u8>) {
                    #to_value
                    #ref_ty::pack(&value, dest)
                }

                #is_empty_container

                fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
                    #to_value
                    #ref_ty::embedded_fixed_pack(&value, dest)
                }

                fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                    #to_value
                    #ref_ty::embedded_fixed_repack(&value, fixed_pos, heap_pos, dest)
                }

                fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
                    #to_value
                    #ref_ty::embedded_variable_pack(&value, dest)
                }
            }
        }
    } else {
        quote! {}
    };

    let unpack_impl = if impl_unpack {
        quote! {
            impl<'a> #fracpack_mod::Unpack<'a> for #name #generics {
                const FIXED_SIZE: u32 = #ty::FIXED_SIZE;
                const VARIABLE_SIZE: bool = #ty::VARIABLE_SIZE;
                const IS_OPTIONAL: bool = #ty::IS_OPTIONAL;

                fn unpack(src: &mut #fracpack_mod::FracInputStream<'a>) -> #fracpack_mod::Result<Self> {
                    let value = #ty::unpack(src)?;
                    Ok(#from_value)
                }

                fn verify(src: &mut #fracpack_mod::FracInputStream) -> #fracpack_mod::Result<()> {
                    #ty::verify(src)
                }

                #new_empty_container

                fn embedded_variable_unpack(
                    src: &mut #fracpack_mod::FracInputStream<'a>,
                    fixed_pos: &mut u32,
                ) -> #fracpack_mod::Result<Self> {
                    let value = #ty::embedded_variable_unpack(src, fixed_pos)?;
                    Ok(#from_value)
                }

                fn embedded_unpack(src: &mut #fracpack_mod::FracInputStream<'a>, fixed_pos: &mut u32) -> #fracpack_mod::Result<Self> {
                    let value = #ty::embedded_unpack(src, fixed_pos)?;
                    Ok(#from_value)
                }

                fn embedded_variable_verify(
                    src: &mut #fracpack_mod::FracInputStream,
                    fixed_pos: &mut u32,
                ) -> #fracpack_mod::Result<()> {
                    #ty::embedded_variable_verify(src, fixed_pos)
                }

                fn embedded_verify(src: &mut #fracpack_mod::FracInputStream, fixed_pos: &mut u32) -> #fracpack_mod::Result<()> {
                    #ty::embedded_verify(src, fixed_pos)
                }
            }
        }
    } else {
        quote! {}
    };

    TokenStream::from(quote! {
        #pack_impl
        #unpack_impl
    })
}

fn process_enum(
    fracpack_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    impl_pack: bool,
    impl_unpack: bool,
    data: &DataEnum,
) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let fields = enum_fields(fracpack_mod, name, data);
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
                #index => <#as_type as #fracpack_mod::Unpack>::verify(src)?,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let pack_impl = if impl_pack {
        quote! {
            impl #impl_generics #fracpack_mod::Pack for #name #ty_generics #where_clause {
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
            }
        }
    } else {
        quote! {}
    };

    let unpack_impl = if impl_unpack {
        quote! {
            impl<'a> #fracpack_mod::Unpack<'a> for #name #generics {
                const FIXED_SIZE: u32 = 4;
                const VARIABLE_SIZE: bool = true;
                fn unpack(outer: &mut #fracpack_mod::FracInputStream<'a>) -> #fracpack_mod::Result<Self> {
                    let index = <u8 as #fracpack_mod::Unpack>::unpack(outer)?;
                    let size = <u32 as #fracpack_mod::Unpack>::unpack(outer)?;
                    let mut inner = outer.read_fixed(size)?;
                    let src = &mut inner;
                    let result = match index {
                        #unpack_items
                        _ => return Err(#fracpack_mod::Error::BadEnumIndex),
                    };
                    if src.has_unknown {
                        outer.has_unknown = true;
                    }
                    src.finish()?;
                    Ok(result)
                }
                // TODO: option to error on unknown index
                fn verify(outer: &mut #fracpack_mod::FracInputStream) -> #fracpack_mod::Result<()> {
                    let index = <u8 as #fracpack_mod::Unpack>::unpack(outer)?;
                    let size = <u32 as #fracpack_mod::Unpack>::unpack(outer)?;
                    let mut inner = outer.read_fixed(size)?;
                    let src = &mut inner;
                    match index {
                        #verify_items
                        _ => return Err(#fracpack_mod::Error::BadEnumIndex),
                    }
                    if src.has_unknown {
                        outer.has_unknown = true;
                    }
                    src.finish()?;
                    Ok(())
                }
            }
        }
    } else {
        quote! {}
    };

    TokenStream::from(quote! {
        #pack_impl
        #unpack_impl
    })
} // process_enum
