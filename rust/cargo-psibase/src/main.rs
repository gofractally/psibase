use anyhow::{anyhow, Context};
use binaryen::{CodegenConfig, Module};
use cargo::core::compiler::{CompileKind, CompileTarget};
use cargo::core::Workspace;
use cargo::ops::{compile, CompileOptions};
use cargo::util::{command_prelude::CompileMode, interning::InternedString};
use cargo::Config;
use parity_wasm::deserialize_buffer;
use parity_wasm::elements::{
    External, Func, FuncBody, ImportEntry, Instruction, Internal, Section, TableElementType, Type,
};
use std::collections::HashMap;
use std::fs::{canonicalize, read, write};
use std::path::Path;

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));
const TESTER_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/tester_wasi_polyfill.wasm"));

#[derive(Clone, Hash, PartialEq, Eq, Debug)]
struct ImportFunction {
    module: String,
    field: String,
    ty: Type,
}

#[derive(Clone, Debug)]
enum OldToNewFn {
    Fn {
        ty: Type,
        body: FuncBody,
        new_index: usize,
    },
    Import(ImportFunction),
    ResolvedImport(usize),
}

fn get_imported_functions(
    module: &parity_wasm::elements::Module,
    types: &[Type],
) -> Vec<ImportFunction> {
    module
        .import_section()
        .unwrap()
        .entries()
        .iter()
        .filter_map(|entry| {
            if let External::Function(ty) = entry.external() {
                Some(ImportFunction {
                    module: entry.module().to_owned(),
                    field: entry.field().to_owned(),
                    ty: types[*ty as usize].clone(),
                })
            } else {
                None
            }
        })
        .collect()
}

fn mark_type(new_types: &mut Vec<Type>, type_map: &mut HashMap<Type, usize>, ty: &Type) {
    if !type_map.contains_key(ty) {
        type_map.insert(ty.clone(), new_types.len());
        new_types.push(ty.clone());
    }
}

#[allow(clippy::too_many_arguments)]
fn mark_function(
    module: &parity_wasm::elements::Module,
    imported_fns: &[ImportFunction],
    num_new_functions: &mut usize,
    old_to_new_fn: &mut Vec<Option<OldToNewFn>>,
    old_types: &Vec<Type>,
    new_types: &mut Vec<Type>,
    type_map: &mut HashMap<Type, usize>,
    index: usize,
) -> Result<(), anyhow::Error> {
    if old_to_new_fn[index].is_some() {
        return Ok(());
    }
    if index < imported_fns.len() {
        old_to_new_fn[index] = Some(OldToNewFn::Import(imported_fns[index].clone()));
        mark_type(new_types, type_map, &imported_fns[index].ty);
    } else {
        let adj_index = index - imported_fns.len();
        let functions = module.function_section().unwrap().entries();
        let code = module.code_section().unwrap().bodies();
        if adj_index >= functions.len() || adj_index >= code.len() {
            return Err(anyhow!("Function index out of bounds"));
        }
        let ty = &old_types[functions[adj_index].type_ref() as usize];
        let body = &code[adj_index];

        old_to_new_fn[index] = Some(OldToNewFn::Fn {
            ty: ty.clone(),
            body: body.clone(),
            new_index: *num_new_functions,
        });
        *num_new_functions += 1;

        mark_type(new_types, type_map, ty);
        for instruction in body.code().elements() {
            if let Instruction::Call(index) = instruction {
                mark_function(
                    module,
                    imported_fns,
                    num_new_functions,
                    old_to_new_fn,
                    old_types,
                    new_types,
                    type_map,
                    *index as usize,
                )?
            }
        }
    }
    Ok(())
}

fn mark_functions(
    module: &parity_wasm::elements::Module,
    imported_fns: &[ImportFunction],
    num_new_functions: &mut usize,
    old_to_new_fn: &mut Vec<Option<OldToNewFn>>,
    old_types: &Vec<Type>,
    new_types: &mut Vec<Type>,
    type_map: &mut HashMap<Type, usize>,
) -> Result<(), anyhow::Error> {
    for entry in module.export_section().unwrap().entries() {
        if let Internal::Function(index) = entry.internal() {
            mark_function(
                module,
                imported_fns,
                num_new_functions,
                old_to_new_fn,
                old_types,
                new_types,
                type_map,
                *index as usize,
            )?;
        }
    }

    if let Some(element) = module.elements_section() {
        if let Some(table) = module.table_section() {
            for entry in element.entries() {
                if entry.index() as usize >= table.entries().len() {
                    return Err(anyhow!("Element references missing table"));
                }
                if table.entries()[entry.index() as usize].elem_type() != TableElementType::AnyFunc
                {
                    return Err(anyhow!("Unsupported table type"));
                }
                for member in entry.members() {
                    mark_function(
                        module,
                        imported_fns,
                        num_new_functions,
                        old_to_new_fn,
                        old_types,
                        new_types,
                        type_map,
                        *member as usize,
                    )?;
                }
            }
        } else {
            return Err(anyhow!("Element references missing table"));
        }
    }
    Ok(())
}

fn fill_functions(
    is_poly: bool,
    old_types: &[Type],
    type_map: &HashMap<Type, usize>,
    old_to_new_fn: &[Option<OldToNewFn>],
    new_imports: &[ImportEntry],
    new_functions: &mut [Option<Func>],
    new_bodies: &mut [Option<FuncBody>],
) -> Result<(), anyhow::Error> {
    for item in old_to_new_fn.iter().flatten() {
        if let OldToNewFn::Fn {
            ty,
            body,
            new_index,
        } = item
        {
            new_functions[*new_index] = Some(Func::new(*type_map.get(ty).unwrap() as u32));
            let mut body = body.clone();
            for instr in body.code_mut().elements_mut() {
                match instr {
                    Instruction::Call(f) => match old_to_new_fn[*f as usize].as_ref().unwrap() {
                        OldToNewFn::Fn {
                            ty: _,
                            body: _,
                            new_index,
                        } => *f = (new_imports.len() + new_index) as u32,
                        OldToNewFn::Import(_) => panic!("unresolved import"),
                        OldToNewFn::ResolvedImport(i) => *f = *i as u32,
                    },
                    Instruction::CallIndirect(ty, _) => {
                        if is_poly {
                            return Err(anyhow!("polyfill has an indirect call"));
                        }
                        *ty = *type_map.get(&old_types[*ty as usize]).unwrap() as u32;
                    }
                    Instruction::GetGlobal(_) => {
                        if is_poly {
                            return Err(anyhow!("polyfill uses a global"));
                        }
                    }
                    Instruction::SetGlobal(_) => {
                        if is_poly {
                            return Err(anyhow!("polyfill uses a global"));
                        }
                    }
                    _ => (),
                }
            }
            new_bodies[*new_index] = Some(body);
        }
    }
    Ok(())
}

// Link polyfill to code and strip out unused functions
fn link(filename: &Path, code: &[u8], polyfill: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    let poly: parity_wasm::elements::Module = deserialize_buffer(polyfill)
        .map_err(|_| anyhow!("Parity-wasm failed to parse polyfill"))?;
    if poly.table_section().is_some()
        || poly.start_section().is_some()
        || poly.elements_section().is_some()
        || poly.data_section().is_some()
    {
        // These sections are unsupported in the polyfill since they
        // would require relocatable wasms to merge. Rust uses lld,
        // which currently errors out when attempting to produce
        // relocatable wasms. If it could produce relocatable wasms,
        // there is an alternative solution to writing this custom
        // linker: feed lld's output, along with the polyfill, back
        // into lld, after repairing names which unfortunately vary
        // over time, e.g.
        // "$_ZN4wasi13lib_generated22wasi_snapshot_preview18fd_write17haadc9440e6dddc5cE"
        //
        // Another option that we may try in the future: rustc doesn't
        // give us enough control over library link order to insert
        // polyfills into the right spot. We could create a linker wrapper
        // which invokes lld after doing the name translation, giving
        // us that control. We'd still have to remove unused functions
        // after link, since neither lld nor binaryen currently do that.
        // wasm-gc does it, but its repo is archived.
        return Err(anyhow!("Polyfill has unexpected section"));
    }
    if poly.type_section().is_none()
        || poly.import_section().is_none()
        || poly.function_section().is_none()
        || poly.code_section().is_none()
        || poly.export_section().is_none()
    {
        return Err(anyhow!("Polyfill has missing section"));
    }

    let poly_old_types = poly.type_section().unwrap().types().to_owned();
    let poly_imported_fns = get_imported_functions(&poly, &poly_old_types);
    let poly_functions = poly.function_section().unwrap().entries();
    let poly_exports = poly.export_section().unwrap().entries();
    let poly_num_functions = poly_imported_fns.len() + poly_functions.len();

    let mut module: parity_wasm::elements::Module = deserialize_buffer(code)
        .map_err(|_| anyhow!("Parity-wasm failed to parse {}", filename.to_string_lossy()))?;
    if module.start_section().is_some() {
        return Err(anyhow!(
            "{} has unsupported start section",
            filename.to_string_lossy()
        ))?;
    }
    if module.type_section().is_none()
        || module.import_section().is_none()
        || module.function_section().is_none()
        || module.code_section().is_none()
        || module.export_section().is_none()
        || !module
            .export_section()
            .unwrap()
            .entries()
            .iter()
            .any(|e| matches!(e.internal(), Internal::Function(_)))
    {
        return Ok(code.to_owned());
    }

    let old_types = module.type_section().unwrap().types().to_owned();
    let imported_fns = get_imported_functions(&module, &old_types);
    let num_functions = imported_fns.len() + module.function_section().unwrap().entries().len();

    let mut num_new_functions = 0;
    let mut new_types = Vec::new();
    let mut old_to_new_fn = vec![None; num_functions];
    let mut type_map = HashMap::new();
    mark_functions(
        &module,
        &imported_fns,
        &mut num_new_functions,
        &mut old_to_new_fn,
        &old_types,
        &mut new_types,
        &mut type_map,
    )?;

    let mut poly_old_to_new_fn = vec![None; poly_num_functions];
    for item in old_to_new_fn.iter_mut().flatten() {
        if let OldToNewFn::Import(import) = item {
            if import.module == "wasi_snapshot_preview1" {
                for export in poly_exports.iter() {
                    if export.field() == import.field {
                        if let Internal::Function(export_fn) = export.internal() {
                            mark_function(
                                &poly,
                                &poly_imported_fns,
                                &mut num_new_functions,
                                &mut poly_old_to_new_fn,
                                &poly_old_types,
                                &mut new_types,
                                &mut type_map,
                                *export_fn as usize,
                            )?;
                            *item = poly_old_to_new_fn[*export_fn as usize].clone().unwrap();
                            break;
                        }
                    }
                }
            }
        }
    }

    let mut new_imports = Vec::new();
    let mut import_map = HashMap::new();
    for item in old_to_new_fn
        .iter_mut()
        .chain(poly_old_to_new_fn.iter_mut())
        .flatten()
    {
        if let OldToNewFn::Import(import) = item {
            if let Some(index) = import_map.get(import) {
                *item = OldToNewFn::ResolvedImport(*index);
            } else {
                import_map.insert(import.clone(), new_imports.len());
                new_imports.push(ImportEntry::new(
                    import.module.clone(),
                    import.field.clone(),
                    External::Function(*type_map.get(&import.ty).unwrap() as u32),
                ));
                *item = OldToNewFn::ResolvedImport(new_imports.len() - 1);
            }
        }
    }

    let mut new_functions = vec![None; num_new_functions];
    let mut new_bodies = vec![None; num_new_functions];
    fill_functions(
        false,
        &old_types,
        &type_map,
        &old_to_new_fn,
        &new_imports,
        &mut new_functions,
        &mut new_bodies,
    )?;
    fill_functions(
        true,
        &poly_old_types,
        &type_map,
        &poly_old_to_new_fn,
        &new_imports,
        &mut new_functions,
        &mut new_bodies,
    )?;

    // for (i, item) in old_to_new_fn.iter().enumerate() {
    //     if let Some(item) = item {
    //         match item {
    //             OldToNewFn::Fn {
    //                 ty: _,
    //                 body: _,
    //                 new_index,
    //             } => println!("func {} -> {}", i, new_imports.len() + new_index),
    //             OldToNewFn::Import(_) => todo!(),
    //             OldToNewFn::ResolvedImport(f) => println!("imp  {} -> {}", i, f),
    //         }
    //     }
    // }

    // Remove all custom sections; psibase doesn't need them
    // and this is easier than translating them.
    //
    // TODO: need an option to to support debugging.
    //       * Don't trim out or reorder functions, since
    //         editing DWARF is a PITA
    //       * Leave custom sections as-is
    //       * Might also need to skip binaryen
    let sections = module.sections_mut();
    *sections = sections
        .drain(..)
        .filter(|s| !matches!(s, Section::Custom(_)))
        .collect();

    for entry in module.export_section_mut().unwrap().entries_mut() {
        if let Internal::Function(f) = entry.internal_mut() {
            *f = match old_to_new_fn[*f as usize].as_ref().unwrap() {
                OldToNewFn::Fn {
                    ty: _,
                    body: _,
                    new_index,
                } => (new_imports.len() + new_index) as u32,
                OldToNewFn::Import(_) => panic!("unresolved import"),
                OldToNewFn::ResolvedImport(i) => *i as u32,
            };
        }
    }

    for entry in module.elements_section_mut().unwrap().entries_mut() {
        for member in entry.members_mut() {
            *member = match old_to_new_fn[*member as usize].as_ref().unwrap() {
                OldToNewFn::Fn {
                    ty: _,
                    body: _,
                    new_index,
                } => (new_imports.len() + new_index) as u32,
                OldToNewFn::Import(_) => panic!("unresolved import"),
                OldToNewFn::ResolvedImport(i) => *i as u32,
            };
        }
    }

    new_imports.extend(
        module
            .import_section()
            .unwrap()
            .entries()
            .iter()
            .filter(|e| !matches!(e.external(), External::Function(_)))
            .cloned(),
    );

    *module.type_section_mut().unwrap().types_mut() = new_types;
    *module.import_section_mut().unwrap().entries_mut() = new_imports;
    *module.function_section_mut().unwrap().entries_mut() =
        new_functions.into_iter().map(|f| f.unwrap()).collect();
    *module.code_section_mut().unwrap().bodies_mut() =
        new_bodies.into_iter().map(|f| f.unwrap()).collect();

    Ok(module.into_bytes()?)
}

fn optimize(filename: &Path, code: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    // println!("optimizing {}", filename.to_string_lossy());
    let mut module = Module::read(code)
        .map_err(|_| anyhow!("Binaryen failed to parse {}", filename.to_string_lossy()))?;
    // println!("before optimize: {}", module.write().len());
    module.optimize(&CodegenConfig {
        shrink_level: 1,
        optimization_level: 2,
        debug_info: false,
    });
    // println!("after optimize: {}", module.write().len());
    Ok(module.write())
}

fn process(filename: &Path, polyfill: &[u8]) -> Result<(), anyhow::Error> {
    println!("{}", filename.to_string_lossy());
    let code = &read(filename)
        .with_context(|| format!("Failed to read {}", filename.to_string_lossy()))?;
    let code = link(filename, code, polyfill)?;
    let code = optimize(filename, &code)?;
    write(filename, code).with_context(|| format!("Failed to write {}", filename.to_string_lossy()))
}

fn main() -> Result<(), anyhow::Error> {
    let config = Config::default()?;
    let workspace = Workspace::new(&canonicalize(Path::new("Cargo.toml"))?, &config)?;
    let mut options = CompileOptions::new(&config, CompileMode::Build)?;
    options.build_config.requested_kinds =
        vec![CompileKind::Target(CompileTarget::new("wasm32-wasi")?)];
    // options.build_config.mode = CompileMode::Test;
    options.build_config.requested_profile = InternedString::new("release");
    let compilation = compile(&workspace, &options)?;
    println!();
    for output in compilation.tests.iter() {
        process(&output.path, TESTER_POLYFILL)?
    }
    for output in compilation.binaries.iter() {
        process(&output.path, TESTER_POLYFILL)?
    }
    for output in compilation.cdylibs.iter() {
        process(&output.path, SERVICE_POLYFILL)?
    }
    Ok(())
}
