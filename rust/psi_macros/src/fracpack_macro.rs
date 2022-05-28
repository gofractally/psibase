use darling::FromDeriveInput;
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DataEnum, DataStruct, DeriveInput, Fields};

/// Fracpack struct level options
#[derive(Debug, Default, FromDeriveInput)]
#[darling(default, attributes(fracpack))]
pub struct Options {
    definition_will_not_change: bool,
}

struct FracpackField<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
}

fn struct_fields(data: &DataStruct) -> Vec<FracpackField> {
    match &data.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|field| FracpackField {
                name: field.ident.as_ref().unwrap(),
                ty: &field.ty,
            })
            .collect(),
        Fields::Unnamed(_) => unimplemented!("fracpack does not support unnamed fields"),
        Fields::Unit => unimplemented!("fracpack does not support unit struct"),
    }
}

fn enum_fields(data: &DataEnum) -> Vec<FracpackField> {
    data.variants
        .iter()
        .map(|var| match &var.fields {
            Fields::Named(_) => unimplemented!("variants must have exactly 1 unnamed field"),
            Fields::Unnamed(field) => {
                assert!(
                    field.unnamed.len() == 1,
                    "variants must have exactly 1 unnamed field"
                );
                FracpackField {
                    name: &var.ident,
                    ty: &field.unnamed[0].ty,
                }
            }
            Fields::Unit => unimplemented!("variants must have exactly 1 unnamed field"),
        })
        .collect()
}

pub fn fracpack_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    // parse fracpack macro options
    let opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };

    match &input.data {
        Data::Struct(data) => process_struct(&input, data, &opts),
        Data::Enum(data) => process_enum(&input, data),
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
fn process_struct(input: &DeriveInput, data: &DataStruct, opts: &Options) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = struct_fields(data);
    let fixed_size = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! {<#ty as fracpack::Packable>::FIXED_SIZE}
        })
        .fold(quote! {0}, |acc, new| quote! {#acc + #new});
    let use_heap = if !opts.definition_will_not_change {
        quote! {true}
    } else {
        fields
            .iter()
            .map(|field| {
                let ty = &field.ty;
                quote! {<#ty as fracpack::Packable>::USE_HEAP}
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
        quote! { <u16 as fracpack::Packable>::pack(&(heap as u16), dest); }
    } else {
        quote! {}
    };
    let unpack_heap_size = if !opts.definition_will_not_change {
        quote! { let heap_size = <u16 as fracpack::Packable>::unpack(src, pos)?; }
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
                <#ty as fracpack::Packable>::embedded_fixed_pack(&self.#name, dest);
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
                <#ty as fracpack::Packable>::embedded_fixed_repack(&self.#name, #pos, dest.len() as u32, dest);
                <#ty as fracpack::Packable>::embedded_variable_pack(&self.#name, dest);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            let ty = &field.ty;
            quote! {
                #name: <#ty as fracpack::Packable>::embedded_unpack(src, pos, &mut heap_pos)?,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    // TODO: skip unknown members
    // TODO: option to verify no unknown members
    let verify = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! { <#ty as fracpack::Packable>::embedded_verify(src, pos, &mut heap_pos)?; }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl<'a> fracpack::Packable<'a> for #name #generics {
            const USE_HEAP: bool = #use_heap;
            const FIXED_SIZE: u32 = if Self::USE_HEAP { 4 } else { #fixed_size };
            fn pack(&self, dest: &mut Vec<u8>) {
                let heap = #fixed_size;
                assert!(heap as u16 as u32 == heap); // TODO: return error
                #pack_heap
                #pack_fixed_members
                #pack_variable_members
            }
            fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
                #unpack_heap_size
                let mut heap_pos = *pos + heap_size as u32;
                if heap_pos < *pos {
                    return Err(fracpack::Error::BadOffset);
                }
                let result = Self {
                    #unpack
                };
                *pos = heap_pos;
                Ok(result)
            }
            fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
                #unpack_heap_size
                let mut heap_pos = *pos + heap_size as u32;
                if heap_pos < *pos {
                    return Err(fracpack::Error::BadOffset);
                }
                #verify
                *pos = heap_pos;
                Ok(())
            }
            fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
                if Self::USE_HEAP {
                    dest.extend_from_slice(&0_u32.to_le_bytes());
                } else {
                    Self::pack(&self, dest);
                }
            }
            fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                if Self::USE_HEAP {
                    dest[fixed_pos as usize..fixed_pos as usize + 4]
                        .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
                }
            }
            fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
                if Self::USE_HEAP {
                    Self::pack(&self, dest);
                }
            }
            fn embedded_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<Self> {
                if Self::USE_HEAP {
                    let orig_pos = *fixed_pos;
                    let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                    if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                        return Err(fracpack::Error::BadOffset);
                    }
                    Self::unpack(src, heap_pos)
                } else {
                    Self::unpack(src, fixed_pos)
                }
            }
            fn embedded_verify(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<()> {
                if Self::USE_HEAP {
                    let orig_pos = *fixed_pos;
                    let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                    if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                        return Err(fracpack::Error::BadOffset);
                    }
                    Self::verify(src, heap_pos)
                } else {
                    Self::verify(src, fixed_pos)
                }
            }
            fn option_fixed_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => dest.extend_from_slice(&0_u32.to_le_bytes()),
                    None => dest.extend_from_slice(&1u32.to_le_bytes()),
                }
            }
            fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => {
                        dest[fixed_pos as usize..fixed_pos as usize + 4]
                            .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
                    }
                    None => (),
                }
            }
            fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => Self::pack(&x, dest),
                    None => (),
                }
            }
            fn option_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<Option<Self>> {
                let orig_pos = *fixed_pos;
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(None);
                }
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(fracpack::Error::BadOffset);
                }
                Ok(Some(Self::unpack(src, heap_pos)?))
            }
            fn option_verify(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<()> {
                let orig_pos = *fixed_pos;
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(());
                }
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(fracpack::Error::BadOffset);
                }
                Self::verify(src, heap_pos)
            }
        }
    })
} // process_struct

fn process_enum(input: &DeriveInput, data: &DataEnum) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = enum_fields(data);
    // TODO: 128? also check during verify and unpack
    assert!(fields.len() < 256);
    let pack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let field_name = &field.name;
            let ty = &field.ty;
            quote! {#name::#field_name(x) => {
                dest.push(#index);
                size_pos = dest.len();
                dest.extend_from_slice(&0_u32.to_le_bytes());
                <#ty as fracpack::Packable>::pack(&x, dest);
            }}
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let field_name = &field.name;
            let ty = &field.ty;
            quote! {
                #index => #name::#field_name(<#ty as fracpack::Packable>::unpack(src, pos)?),
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let verify_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let ty = &field.ty;
            quote! {
                #index => <#ty as fracpack::Packable>::verify(src, pos)?,
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl<'a> fracpack::Packable<'a> for #name #generics {
            const FIXED_SIZE: u32 = 4;
            const USE_HEAP: bool = true;
            fn pack(&self, dest: &mut Vec<u8>) {
                let size_pos;
                match &self {
                    #pack_items
                };
                let size = (dest.len() - size_pos - 4) as u32;
                dest[size_pos..size_pos + 4].copy_from_slice(&size.to_le_bytes());
            }
            fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
                let index = <u8 as fracpack::Packable>::unpack(src, pos)?;
                let size_pos = *pos;
                let size = <u32 as fracpack::Packable>::unpack(src, pos)?;
                let result = match index {
                    #unpack_items
                    _ => return Err(fracpack::Error::BadEnumIndex),
                };
                if *pos != size_pos + 4 + size {
                    return Err(fracpack::Error::BadSize);
                }
                Ok(result)
            }
            // TODO: option to error on unknown index
            fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
                let index = <u8 as fracpack::Packable>::unpack(src, pos)?;
                let size_pos = *pos;
                let size = <u32 as fracpack::Packable>::unpack(src, pos)?;
                match index {
                    #verify_items
                    _ => {
                        *pos = size_pos + 4 + size;
                        return Ok(());
                    }
                }
                if *pos != size_pos + 4 + size {
                    return Err(fracpack::Error::BadSize);
                }
                Ok(())
            }
            fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&0_u32.to_le_bytes());
            }
            fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
            }
            fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
                <Self as fracpack::Packable>::pack(&self, dest)
            }
            fn embedded_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<Self> {
                let orig_pos = *fixed_pos;
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;

                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(fracpack::Error::BadOffset);
                }
                <Self as fracpack::Packable>::unpack(src, heap_pos)
            }
            fn embedded_verify(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<()> {
                let orig_pos = *fixed_pos;
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;

                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(fracpack::Error::BadOffset);
                }
                <Self as fracpack::Packable>::verify(src, heap_pos)
            }
            fn option_fixed_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => <Self as fracpack::Packable>::embedded_fixed_pack(x, dest),
                    None => dest.extend_from_slice(&1u32.to_le_bytes()),
                }
            }
            fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => {
                        <Self as fracpack::Packable>::embedded_fixed_repack(x, fixed_pos, heap_pos, dest)
                    }
                    None => (),
                }
            }
            fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
                match opt {
                    Some(x) => <Self as fracpack::Packable>::embedded_variable_pack(x, dest),
                    None => (),
                }
            }
            fn option_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<Option<Self>> {
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(None);
                }
                *fixed_pos -= 4;
                Ok(Some(<Self as fracpack::Packable>::embedded_unpack(
                    src, fixed_pos, heap_pos,
                )?))
            }
            fn option_verify(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> fracpack::Result<()> {
                let offset = <u32 as fracpack::Packable>::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(());
                }
                *fixed_pos -= 4;
                <Self as fracpack::Packable>::embedded_verify(src, fixed_pos, heap_pos)
            }
        }
    })
} // process_enum
