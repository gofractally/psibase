use clap::{Parser, Subcommand};
use mdbook::preprocess::CmdPreprocessor;
use mdbook::BookItem;
use regex::{Captures, Regex};
use std::cmp::max;
use std::collections::HashMap;
use std::path::Path;
use std::{fs, io};
use yaml_rust::{Yaml, YamlLoader};

#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    #[clap(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Supports { renderer: String },
}

#[derive(Copy, Clone)]
enum Type {
    Namespace,
    Function,
    Record,
}

struct Item {
    yaml_index: usize,
    name: String,
    _ty: Type,
    parent: Option<usize>,
    children: Vec<usize>,
}

fn load_yamls(dir: &Path, yamls: &mut Vec<Yaml>) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                load_yamls(&path, yamls)?;
            } else {
                yamls.append(
                    &mut YamlLoader::load_from_str(
                        &fs::read_to_string(entry.path().to_str().unwrap()).unwrap(),
                    )
                    .unwrap(),
                );
            }
        }
    }
    Ok(())
}

fn convert_item<'a>(
    yamls: &'a mut Vec<Yaml>,
    by_usr: &'a mut HashMap<String, usize>,
    items: &'a mut Vec<Item>,
    parent: Option<usize>,
    ty: Type,
    usr: &str,
) -> Option<usize> {
    let mut ancestor = parent;
    while let Some(x) = ancestor {
        if yamls[items[x].yaml_index]["USR"].as_str().unwrap() == usr {
            return None;
        }
        ancestor = items[x].parent;
    }
    if let Some(i) = by_usr.get(usr) {
        let i = *i;
        let index = items.len();
        items.push(Item {
            yaml_index: i,
            name: yamls[i]["Name"].as_str().unwrap_or("").to_owned(),
            _ty: ty,
            parent,
            children: Vec::new(),
        });
        convert_items(
            yamls,
            by_usr,
            items,
            index,
            i,
            "ChildNamespaces",
            Type::Namespace,
            false,
        );
        convert_items(
            yamls,
            by_usr,
            items,
            index,
            i,
            "ChildRecords",
            Type::Function,
            false,
        );
        convert_items(
            yamls,
            by_usr,
            items,
            index,
            i,
            "ChildFunctions",
            Type::Record,
            true,
        );
        Some(index)
    } else {
        None
    }
} // convert_item

#[allow(clippy::too_many_arguments)]
fn convert_items<'a>(
    yamls: &'a mut Vec<Yaml>,
    by_usr: &'a mut HashMap<String, usize>,
    items: &'a mut Vec<Item>,
    parent: usize,
    children_in_index: usize,
    children_name: &str,
    ty: Type,
    create_children: bool,
) {
    let empty = Vec::new();
    for x in yamls[children_in_index][children_name]
        .clone()
        .as_vec()
        .unwrap_or(&empty)
        .iter()
    {
        let usr = x["USR"].as_str().unwrap();
        if create_children && by_usr.get(usr).is_none() {
            yamls.push(x.clone());
            by_usr.insert(usr.to_owned(), yamls.len() - 1);
        }
        if let Some(index) = convert_item(yamls, by_usr, items, Some(parent), ty, usr) {
            items[parent].children.push(index);
        }
    }
}

fn lookup<'a>(
    yamls: &'a mut Vec<Yaml>,
    items: &Vec<Item>,
    parent: usize,
    path: &[&str],
    recursed: bool,
    result: &mut Vec<usize>,
) {
    if path.is_empty() {
        if recursed {
            result.push(parent);
        }
        return;
    }
    let item = &items[parent];
    for child_index in &item.children {
        if items[*child_index].name == path[0] {
            lookup(yamls, items, *child_index, &path[1..], true, result);
        }
    }
    if result.is_empty() && !recursed {
        if let Some(grandparent) = item.parent {
            lookup(yamls, items, grandparent, path, recursed, result);
        }
    }
}

fn process_directive<'a>(
    yamls: &'a mut Vec<Yaml>,
    items: &Vec<Item>,
    global_namespace: usize,
    path: &str,
) -> String {
    let empty = Vec::new();
    let mut found_indexes = Vec::new();
    lookup(
        yamls,
        items,
        global_namespace,
        &path
            .split("::")
            .filter(|s| !s.is_empty())
            .collect::<Vec<&str>>(),
        false,
        &mut found_indexes,
    );

    if found_indexes.is_empty() {
        panic!("{} not found", path);
    }

    let mut result = String::new();
    for index in found_indexes {
        let item = &items[index];
        let mut desc = String::new();
        for a in yamls[item.yaml_index]["Description"]
            .as_vec()
            .unwrap_or(&empty)
            .iter()
        {
            if a["Kind"].as_str().unwrap_or("") == "FullComment" {
                for b in a["Children"].as_vec().unwrap_or(&empty).iter() {
                    if b["Kind"].as_str().unwrap_or("") == "ParagraphComment" {
                        for c in b["Children"].as_vec().unwrap_or(&empty).iter() {
                            if c["Kind"].as_str().unwrap_or("") == "TextComment" {
                                let mut line = c["Text"].as_str().unwrap_or("");
                                if !line.is_empty() && *line.as_bytes().get(0).unwrap() == b' ' {
                                    line = &line[1..];
                                }
                                desc.push_str(line);
                                desc.push('\n');
                            }
                        }
                        desc.push('\n');
                    }
                }
            }
        }
        // eprintln!("---\n{}---\n", desc);

        let get_param_type = |param: &Yaml| {
            let mut t = param["Type"]["Name"].as_str().unwrap_or("");
            if t.starts_with("enum ") {
                t = &t[5..];
            }
            t.to_owned()
        };

        let mut def = String::new();
        def.push_str("```c++\n");
        def.push_str(&item.name);
        def.push(' ');
        def.push_str(&path[2..]);
        def.push('(');
        let params = yamls[item.yaml_index]["Params"].as_vec().unwrap_or(&empty);
        let mut type_size = 0usize;
        for param in params.iter() {
            type_size = max(type_size, get_param_type(param).len());
        }
        let mut need_comma = false;
        for param in params.iter() {
            if need_comma {
                def.push(',');
            }
            def.push_str("\n    ");
            def.push_str(&format!("{:1$}", get_param_type(param), type_size + 1));
            def.push_str(param["Name"].as_str().unwrap_or(""));
            need_comma = true;
        }
        if need_comma {
            def.push('\n');
        }
        def.push_str(");\n");
        def.push_str("```\n");

        result.push_str(&format!("### {}\n\n{}\n{}\n", &path[2..], def, desc));
    }
    result
} // process_directive

fn main() -> Result<(), anyhow::Error> {
    let re1 = Regex::new(r"[{][{] *#cpp-doc +(::[^ ]+)+ *[}][}]").unwrap();
    let args = Args::parse();
    if args.command.is_some() {
        return Ok(());
    }

    let (ctx, mut book) = CmdPreprocessor::parse_input(io::stdin())?;
    let mut path = ctx.root;
    path.push("../../build/doc-wasm");
    let mut yamls = Vec::new();
    load_yamls(&path, &mut yamls)?;
    let mut by_usr = HashMap::new();
    for (i, x) in yamls.iter().enumerate() {
        by_usr.insert(x["USR"].as_str().unwrap().to_owned(), i);
    }

    let mut items = Vec::new();
    let xx = convert_item(
        &mut yamls,
        &mut by_usr,
        &mut items,
        None,
        Type::Namespace,
        "0000000000000000000000000000000000000000",
    );
    if let Some(global_namespace) = xx {
        book.for_each_mut(|item: &mut BookItem| match item {
            BookItem::Chapter(chapter) => {
                chapter.content = re1
                    .replace_all(&chapter.content, |caps: &Captures| {
                        let path = caps.get(1).unwrap().as_str();
                        process_directive(&mut yamls, &items, global_namespace, path)
                    })
                    .to_string();
            }
            BookItem::Separator => (),
            BookItem::PartTitle(_) => (),
        });
    }

    serde_json::to_writer(io::stdout(), &book)?;

    Ok(())
}
