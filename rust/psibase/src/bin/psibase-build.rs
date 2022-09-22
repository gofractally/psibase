use anyhow::{anyhow, Context};
use binaryen::{CodegenConfig, Module};
use cargo::{
    core::{
        compiler::{CompileKind, CompileTarget},
        Workspace,
    },
    ops::{compile, CompileOptions},
    util::{command_prelude::CompileMode, interning::InternedString},
    Config,
};
use parity_wasm::{
    deserialize_buffer,
    elements::{External, Instruction, Internal, Section, TableElementType},
};
use std::{
    fs::{canonicalize, read, write},
    path::Path,
};

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));
const TESTER_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/tester_wasi_polyfill.wasm"));

fn mark_function(
    module: &parity_wasm::elements::Module,
    num_fn_imports: u32,
    keep_functions: &mut Vec<bool>,
    index: u32,
) -> Result<(), anyhow::Error> {
    if keep_functions[index as usize] {
        return Ok(());
    }
    keep_functions[index as usize] = true;
    if index >= num_fn_imports {
        let adj_index = index - num_fn_imports;
        if let Some(functions) = module.function_section() {
            if adj_index as usize >= functions.entries().len() {
                return Err(anyhow!("Function index out of bounds"));
            }
        } else {
            return Err(anyhow!("Function index out of bounds"));
        }
        if let Some(code) = module.code_section() {
            if adj_index as usize >= code.bodies().len() {
                return Err(anyhow!("Function index out of bounds"));
            }
            for instruction in code.bodies()[adj_index as usize].code().elements() {
                match instruction {
                    Instruction::Call(index) => {
                        mark_function(module, num_fn_imports, keep_functions, *index)
                    }
                    _ => Ok(()),
                }?;
            }
        } else {
            return Err(anyhow!("Function index out of bounds"));
        }
    }
    Ok(())
}

fn mark_functions(
    module: &parity_wasm::elements::Module,
    num_fn_imports: u32,
    keep_functions: &mut Vec<bool>,
) -> Result<(), anyhow::Error> {
    if let Some(export) = module.export_section() {
        for entry in export.entries() {
            if let Internal::Function(index) = entry.internal() {
                mark_function(module, num_fn_imports, keep_functions, *index)?;
            }
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
                    mark_function(module, num_fn_imports, keep_functions, *member)?;
                }
            }
        } else {
            return Err(anyhow!("Element references missing table"));
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
        // Table, element, and data sections are unsupported in the
        // polyfill since they would require relocatable wasms to
        // merge. Rust always invokes lld, which currently errors out
        // when attempting to produce relocatable wasms. If it could
        // produce relocatable wasms, there may have been a better
        // solution than writing this custom linker.
        return Err(anyhow!("Polyfill has unexpected section"));
    }

    let mut module: parity_wasm::elements::Module = deserialize_buffer(code)
        .map_err(|_| anyhow!("Parity-wasm failed to parse {}", filename.to_string_lossy()))?;
    if module.start_section().is_some() {
        return Err(anyhow!(
            "{} has unsupported start section",
            filename.to_string_lossy()
        ))?;
    }

    let num_fn_imports = if let Some(imports) = module.import_section() {
        imports.functions() as u32
    } else {
        0
    };

    let num_functions = num_fn_imports
        + if let Some(functions) = module.function_section() {
            functions.entries().len() as u32
        } else {
            0
        };

    let mut keep_functions = vec![false; num_functions as usize];
    mark_functions(&module, num_fn_imports, &mut keep_functions)?;

    let num_types = if let Some(types) = module.type_section() {
        types.types().len()
    } else {
        0
    };

    let mut keep_types = vec![false; num_types];
    if let Some(functions) = module.function_section() {
        for (i, f) in functions.entries().iter().enumerate() {
            if keep_functions[i] {
                keep_types[f.type_ref() as usize] = true;
            }
        }
    }

    let mut next_type = 0;
    let mut old_to_new_type = vec![0; num_types as usize];
    for (index, include) in keep_types.iter().enumerate() {
        if *include {
            old_to_new_type[index] = next_type;
            next_type += 1;
        }
    }

    let mut next_function = 0;
    let mut old_to_new_fn = vec![0; num_functions as usize];
    for (index, include) in keep_functions.iter().enumerate() {
        if *include {
            old_to_new_fn[index] = next_function;
            next_function += 1;
        }
    }

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

    if let Some(s) = module.type_section_mut() {
        let types = s.types_mut();
        *types = types
            .drain(..)
            .enumerate()
            .filter_map(|(i, t)| if keep_types[i] { Some(t) } else { None })
            .collect();
    }

    if let Some(imports) = module.import_section_mut() {
        let mut function_index = 0;
        let entries = imports.entries_mut();
        *entries = entries
            .drain(..)
            .filter_map(|mut entry| {
                if let External::Function(ty) = entry.external_mut() {
                    function_index += 1;
                    if keep_functions[function_index - 1] {
                        *ty = old_to_new_type[*ty as usize];
                        Some(entry)
                    } else {
                        None
                    }
                } else {
                    Some(entry)
                }
            })
            .collect();
    }

    if let Some(functions) = module.function_section_mut() {
        let entries = functions.entries_mut();
        *entries = entries
            .drain(..)
            .enumerate()
            .filter_map(|(i, mut f)| {
                if keep_functions[i] {
                    let ty = f.type_ref_mut();
                    *ty = old_to_new_type[*ty as usize];
                    Some(f)
                } else {
                    None
                }
            })
            .collect();
    }

    if let Some(exports) = module.export_section_mut() {
        for entry in exports.entries_mut() {
            if let Internal::Function(f) = entry.internal_mut() {
                *f = old_to_new_fn[*f as usize];
            }
        }
    }

    if let Some(elements) = module.elements_section_mut() {
        for entry in elements.entries_mut() {
            for member in entry.members_mut() {
                *member = old_to_new_fn[*member as usize];
            }
        }
    }

    if let Some(code) = module.code_section_mut() {
        let bodies = code.bodies_mut();
        *bodies = bodies
            .drain(..)
            .enumerate()
            .filter_map(|(i, mut body)| {
                if keep_functions[i] {
                    for instruction in body.code_mut().elements_mut() {
                        if let Instruction::Call(index) = instruction {
                            *index = old_to_new_fn[*index as usize];
                        }
                    }
                    Some(body)
                } else {
                    None
                }
            })
            .collect();
    }

    Ok(module.into_bytes()?)
}

fn optimize(filename: &Path, code: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    println!("optimizing {}", filename.to_string_lossy());
    let mut module = Module::read(code)
        .map_err(|_| anyhow!("Binaryen failed to parse {}", filename.to_string_lossy()))?;
    println!("before optimize: {}", module.write().len());
    module.optimize(&CodegenConfig {
        shrink_level: 1,
        optimization_level: 2,
        debug_info: false,
    });
    println!("after optimize: {}", module.write().len());
    Ok(module.write())
}

fn process(filename: &Path, polyfill: &[u8]) -> Result<(), anyhow::Error> {
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
    options.build_config.requested_profile = InternedString::new("release");
    let compilation = compile(&workspace, &options)?;
    for output in compilation.binaries.iter() {
        process(&output.path, TESTER_POLYFILL)?
    }
    for output in compilation.cdylibs.iter() {
        process(&output.path, SERVICE_POLYFILL)?
    }
    Ok(())
}
