use clap::{Parser, Subcommand};
use mdbook::preprocess::CmdPreprocessor;
use mdbook::BookItem;
use regex::{CaptureMatches, Captures, Regex};
use std::cell::Cell;
use std::cmp::max;
use std::collections::HashMap;
use std::fs::DirEntry;
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

fn visit_dirs(dir: &Path, cb: &dyn Fn(&DirEntry)) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit_dirs(&path, cb)?;
            } else {
                cb(&entry);
            }
        }
    }
    Ok(())
}

fn process_directive<'r, 't>(
    map: &HashMap<&str, &Yaml>,
    global_namespace: &Yaml,
    path: &str,
    matches: CaptureMatches<'r, 't>,
) -> String {
    let mut item = global_namespace;
    let empty = Vec::new();
    for matched_path in matches {
        let items = item["ChildNamespaces"].as_vec().unwrap_or(&empty).iter();
        let items = items.chain(item["ChildRecords"].as_vec().unwrap_or(&empty));
        let items = items.chain(item["ChildFunctions"].as_vec().unwrap_or(&empty));
        let items: Vec<&Yaml> = items.collect();
        let pos = items.iter().position(|item| {
            item["Name"].as_str().unwrap_or("") == matched_path.get(1).unwrap().as_str()
        });
        if let Some(pos) = pos {
            let next_item = map.get(items[pos]["USR"].as_str().unwrap());
            if let Some(next_item) = next_item {
                item = *next_item;
            } else {
                item = items[pos];
            }
        } else {
            panic!("{} not found", path);
        }
    }

    // eprintln!("{:?}", item);
    let mut desc = String::new();
    for a in item["Description"].as_vec().unwrap_or(&empty).iter() {
        if a["Kind"].as_str().unwrap_or("") == "FullComment" {
            for b in a["Children"].as_vec().unwrap_or(&empty).iter() {
                if b["Kind"].as_str().unwrap_or("") == "ParagraphComment" {
                    for c in b["Children"].as_vec().unwrap_or(&empty).iter() {
                        if c["Kind"].as_str().unwrap_or("") == "TextComment" {
                            let mut line = c["Text"].as_str().unwrap_or("");
                            if line.len() > 0 && line.bytes().nth(0).unwrap() == b' ' {
                                line = &line[1..];
                            }
                            desc.push_str(line);
                            desc.push_str("\n");
                        }
                    }
                    desc.push_str("\n");
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
    def.push_str(item["ReturnType"]["Type"]["Name"].as_str().unwrap_or(""));
    def.push_str(" ");
    def.push_str(&path[2..]);
    def.push_str("(");
    let params = item["Params"].as_vec().unwrap_or(&empty);
    let mut type_size = 0usize;
    for param in params.iter() {
        type_size = max(type_size, get_param_type(param).len());
    }
    let mut need_comma = false;
    for param in params.iter() {
        if need_comma {
            def.push_str(",");
        }
        def.push_str("\n    ");
        def.push_str(&format!("{:1$}", get_param_type(param), type_size + 1));
        def.push_str(param["Name"].as_str().unwrap_or(""));
        need_comma = true;
    }
    if need_comma {
        def.push_str("\n");
    }
    def.push_str(");\n");
    def.push_str("```\n");

    format!("### {}\n\n{}\n{}\n", &path[2..], def, desc)
}

fn main() -> Result<(), anyhow::Error> {
    let re1 = Regex::new(r"[{][{] *#cpp-doc +(::[^ ]+)+ *[}][}]").unwrap();
    let re2 = Regex::new(r"::([^: ]+)").unwrap();
    let args = Args::parse();
    if args.command.is_some() {
        return Ok(());
    }

    let (ctx, mut book) = CmdPreprocessor::parse_input(io::stdin())?;
    let mut path = ctx.root;
    path.push("../../build/doc-wasm");
    let definitions = Cell::new(Vec::new());
    visit_dirs(&path, &|entry| {
        // eprintln!("{}", entry.path().to_str().unwrap());
        let mut defs = definitions.take();
        defs.append(
            &mut YamlLoader::load_from_str(
                &fs::read_to_string(entry.path().to_str().unwrap()).unwrap(),
            )
            .unwrap(),
        );
        definitions.set(defs);
    })?;
    let definitions = definitions.take();
    let mut map = HashMap::new();
    for x in definitions.iter() {
        map.insert(x["USR"].as_str().unwrap(), x);
    }

    if let Some(global_namespace) = map.get("0000000000000000000000000000000000000000") {
        book.for_each_mut(|item: &mut BookItem| match item {
            BookItem::Chapter(chapter) => {
                chapter.content = re1
                    .replace_all(&chapter.content, |caps: &Captures| {
                        let path = caps.get(1).unwrap().as_str();
                        process_directive(&map, global_namespace, path, re2.captures_iter(path))
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
