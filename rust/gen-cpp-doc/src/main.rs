use clang::documentation::{Comment, CommentChild};
use clang::{Entity, EntityKind, TranslationUnit};
use clap::{Parser, Subcommand};
use mdbook::preprocess::CmdPreprocessor;
use mdbook::BookItem;
use regex::{Captures, Regex};
use std::cmp::max;
use std::collections::BTreeMap;
use std::env;
use std::io;

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

#[derive(Copy, Clone, Debug, PartialEq)]
enum Kind {
    Namespace,
    Function,
    Enum,
    Struct,
}

struct Item<'tu> {
    entity: Entity<'tu>,
    name: String,
    full_name: String,
    kind: Kind,
    parent: Option<usize>,
    children: BTreeMap<String, Vec<usize>>,
    doc_str: String,
    url: String,
}

// Convert children of entity to items
fn convert_children<'a, 'tu>(items: &'a mut Vec<Item<'tu>>, current: usize, entity: Entity<'tu>) {
    for child in entity.get_children() {
        match child.get_kind() {
            EntityKind::ClassDecl => {
                convert_child(items, current, child, Kind::Struct, false);
            }
            EntityKind::EnumDecl => {
                convert_child(items, current, child, Kind::Enum, false);
            }
            EntityKind::FunctionDecl => {
                convert_child(items, current, child, Kind::Function, false);
            }
            EntityKind::FunctionTemplate => {
                convert_child(items, current, child, Kind::Function, false);
            }
            EntityKind::StructDecl => {
                convert_child(items, current, child, Kind::Struct, false);
            }
            EntityKind::Namespace => {
                convert_child(items, current, child, Kind::Namespace, true);
            }
            _ => (),
        }
    }
}

// Convert a child and insert it into parent
#[allow(clippy::unnecessary_unwrap)]
fn convert_child<'a, 'tu>(
    items: &'a mut Vec<Item<'tu>>,
    current: usize,
    entity: Entity<'tu>,
    ty: Kind,
    merge: bool,
) -> usize {
    let name;
    if let Some(n) = entity.get_name() {
        name = n;
    } else if ty == Kind::Namespace {
        name = "@anonymous".to_owned();
    } else {
        name = String::new();
    }
    let items_len = items.len();
    let matching_children = items[current].children.get_mut(&name);
    let child;
    if merge && matching_children.is_some() {
        child = matching_children.unwrap()[0];
    } else {
        child = items_len;
        if let Some(y) = matching_children {
            y.push(child);
        } else {
            items[current].children.insert(name.clone(), vec![child]);
        }

        let full_name = if items[current].full_name.is_empty() {
            name.clone()
        } else {
            items[current].full_name.clone() + "::" + &name
        };

        items.push(Item {
            entity,
            name,
            full_name,
            kind: ty,
            parent: Some(current),
            children: BTreeMap::new(),
            doc_str: convert_doc_str(&entity.get_parsed_comment()),
            url: String::new(),
        });
    }
    convert_children(items, child, entity);
    child
}

#[allow(dead_code)]
fn dump_items(items: &Vec<Item>, current: usize, indent: usize) {
    let item = &items[current];
    eprintln!(
        "{}{:?} {} {}",
        " ".repeat(indent),
        item.kind,
        item.name,
        item.full_name
    );
    for children in item.children.values() {
        for child in children {
            dump_items(items, *child, indent + 4);
        }
    }
}

fn get_items<'tu>(tu: &'tu TranslationUnit) -> Vec<Item<'tu>> {
    let mut items = vec![Item {
        entity: tu.get_entity(),
        name: String::new(),
        full_name: String::new(),
        kind: Kind::Namespace,
        parent: None,
        children: BTreeMap::new(),
        doc_str: String::new(),
        url: String::new(),
    }];
    convert_children(&mut items, 0, tu.get_entity());
    // dump_items(&items, 0, 0);
    items
}

// Convert comments to markdown. Assumes any formatting within the comments are
// compatible with markdown (doesn't escape).
fn convert_doc_str(comment: &Option<Comment>) -> String {
    let mut result = String::new();
    if let Some(comment) = comment {
        let mut is_brief = true;
        for child in comment.get_children() {
            if let CommentChild::Paragraph(lines) = child {
                let mut need_nl = false;
                for line in lines {
                    if let CommentChild::Text(text) = line {
                        if need_nl {
                            result.push('\n');
                        }
                        need_nl = true;
                        let mut text = text.as_str();
                        if !text.is_empty() && *text.as_bytes().get(0).unwrap() == b' ' {
                            text = &text[1..];
                        }
                        result.push_str(text);
                    }
                }
                if is_brief {
                    result.push('.');
                    is_brief = false;
                }
                result.push_str("\n\n");
            }
        }
    }
    result
}

// Look up item by path and fill result. There may be multiple matches (e.g. function overloads).
fn lookup(
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
    for (name, indexes) in &item.children {
        if name == path[0] {
            for index in indexes {
                lookup(items, *index, &path[1..], true, result);
            }
        }
    }
    if result.is_empty() && !recursed {
        if let Some(grandparent) = item.parent {
            lookup(items, grandparent, path, recursed, result);
        }
    }
}

// Set the url field of every item embedded in a chapter
fn set_urls(chapter: &mdbook::book::Chapter, items: &mut Vec<Item>, path: &str) {
    let mut chapter_path = chapter
        .path
        .clone()
        .unwrap()
        .to_str()
        .unwrap()
        .replace(".md", ".html");
    chapter_path.insert(0, '/');
    let mut indexes = Vec::new();
    lookup(
        items,
        0,
        &path
            .split("::")
            .filter(|s| !s.is_empty())
            .collect::<Vec<&str>>(),
        false,
        &mut indexes,
    );
    for index in indexes {
        let item = &mut items[index];
        item.url = chapter_path.clone() + &hash_link(&item.full_name);
    }
}

// Replace "::a::b::c" with "#abc"
fn hash_link(x: &str) -> String {
    let mut link_name = x.replace("::", "");
    link_name.make_ascii_lowercase();
    String::from('#') + &link_name
}

// Replace text of the form "foo" or "foo::bar::baz" with a link
fn fill_link(text: &str, items: &Vec<Item>, parent: usize) -> Option<String> {
    let mut candidates = Vec::new();
    lookup(
        items,
        parent,
        &text
            .split("::")
            .filter(|s| !s.is_empty())
            .collect::<Vec<&str>>(),
        false,
        &mut candidates,
    );
    if !candidates.is_empty() && !items[candidates[0]].url.is_empty() {
        Some(String::new() + "[" + text + "](" + &items[candidates[0]].url + ")")
    } else {
        None
    }
}

// Replace all occurrences of the form "[foo]" or "[foo::bar::baz]" with a link. Leaves
// "[...](...)" untouched.
fn fill_all_links(text: &str, items: &Vec<Item>, parent: usize) -> String {
    let re = Regex::new(r"[\[]([^\]\n]+)[\]]([(][^)]*[)])?").unwrap();
    re.replace_all(text, |caps: &Captures| {
        if caps.get(2).is_some() {
            caps.get(0).unwrap().as_str().to_owned()
        } else {
            let str = caps.get(1).unwrap().as_str();
            let link = fill_link(str, items, parent);
            if let Some(link) = link {
                link
            } else {
                caps.get(0).unwrap().as_str().to_owned()
            }
        }
    })
    .into_owned()
}

// Generate documentation for matching items
fn generate_documentation(items: &Vec<Item>, path: &str) -> String {
    let mut found_indexes = Vec::new();
    lookup(
        items,
        0,
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
        match items[index].kind {
            Kind::Enum => document_enum(items, index, path, &mut result),
            Kind::Function => document_function(items, index, path, &mut result),
            Kind::Struct => document_struct(items, index, path, &mut result),
            _ => (),
        }
    }
    result
}

fn document_enum(items: &Vec<Item>, index: usize, path: &str, result: &mut String) {
    let item = &items[index];
    let mut def = String::new();
    def.push_str("<pre><code class=\"language-c++\">");
    document_template_args(item, &mut def);
    def.push_str(&(String::from("enum ") + &path[2..]));
    if let Some(under) = item.entity.get_enum_underlying_type() {
        def.push_str(&(String::from(": ") + &under.get_display_name()));
    }
    def.push_str(" {");

    let constants: Vec<Entity> = filter_children(&item.entity, |c| {
        c.get_kind() == EntityKind::EnumConstantDecl
    });
    let mut name_size = 0usize;
    for c in constants.iter() {
        name_size = max(name_size, c.get_display_name().unwrap().len());
    }
    for c in constants.iter() {
        let name = c.get_display_name().unwrap();
        let val = c.get_enum_constant_value().unwrap().0.to_string();
        def.push_str("\n    ");
        def.push_str(&format!(
            "<a href=\"{3}\">{1}{0:2$} = {4}, // {5}</a>",
            "",
            name,
            name_size - name.len(),
            hash_link(&(path[2..].to_owned() + &name)),
            val,
            c.get_comment_brief().unwrap()
        ));
    }
    def.push_str("\n};\n");
    def.push_str("</code></pre>\n");
    result.push_str(&format!(
        "### {}\n\n{}\n{}\n",
        &path[2..],
        def,
        fill_all_links(&item.doc_str, items, index)
    ));

    for c in constants.iter() {
        let doc_str = convert_doc_str(&c.get_parsed_comment());
        // eprintln!("---\n{}\n---\n", fill_all_links(&doc_str, items, index));
        if !doc_str.is_empty() {
            result.push_str(&format!(
                "### {}::{}\n\n{}\n",
                &path[2..],
                c.get_name().unwrap(),
                fill_all_links(&doc_str, items, index)
            ));
        }
    }
} // document_enum

fn document_struct(items: &Vec<Item>, index: usize, path: &str, result: &mut String) {
    let item = &items[index];
    let mut def = String::new();
    def.push_str("<pre><code class=\"language-c++\">");
    document_template_args(item, &mut def);
    def.push_str(&(String::from("struct ") + &path[2..]));
    def.push_str(" {\n");

    let fields = filter_children(&item.entity, |c| c.get_kind() == EntityKind::FieldDecl);
    let mut type_size = 0;
    let mut name_size = 0;
    for arg in fields.iter() {
        type_size = max(type_size, arg.get_type().unwrap().get_display_name().len());
        name_size = max(name_size, arg.get_name().unwrap().len());
    }
    for field in fields.iter() {
        let ty = field.get_type().unwrap().get_display_name();
        let name = field.get_name().unwrap();
        def.push_str(&format!(
            "    {1}{0:2$} {3};{0:4$} // {5}\n",
            "",
            escape_html(&ty),
            type_size - ty.len(),
            name,
            name_size - name.len(),
            field.get_comment_brief().unwrap_or_default()
        ));
    }
    def.push_str("};\n</code></pre>\n");
    result.push_str(&format!(
        "### {}\n\n{}\n{}\n",
        &path[2..],
        def,
        fill_all_links(&item.doc_str, items, index)
    ));
} // document_struct

fn document_function(items: &Vec<Item>, index: usize, path: &str, result: &mut String) {
    let item = &items[index];
    let mut def = String::new();
    def.push_str("```text\n");
    document_template_args(item, &mut def);
    def.push_str(&item.entity.get_result_type().unwrap().get_display_name());
    def.push(' ');
    def.push_str(&path[2..]);
    def.push('(');

    let args: Vec<Entity> = filter_children(&item.entity, |c| c.get_kind() == EntityKind::ParmDecl);
    let mut type_size = 0usize;
    for arg in args.iter() {
        type_size = max(type_size, arg.get_type().unwrap().get_display_name().len());
    }
    let mut need_comma = false;
    for arg in args.iter() {
        if need_comma {
            def.push(',');
        }
        def.push_str("\n    ");
        def.push_str(&format!(
            "{:1$}{2}",
            arg.get_type().unwrap().get_display_name(),
            type_size + 1,
            arg.get_name().unwrap()
        ));
        need_comma = true;
    }
    if need_comma {
        def.push('\n');
    }
    def.push_str(");\n");
    def.push_str("```\n");

    result.push_str(&format!(
        "### {}\n\n{}\n{}\n",
        &path[2..],
        def,
        fill_all_links(&item.doc_str, items, index)
    ));
} // document_function

fn document_template_args(item: &Item, def: &mut String) {
    let template_args: Vec<Entity> = filter_children(&item.entity, |c| {
        c.get_kind() == EntityKind::TemplateTypeParameter
            || c.get_kind() == EntityKind::NonTypeTemplateParameter
    });
    if !template_args.is_empty() {
        def.push_str("template<");
        let mut need_comma = false;
        for arg in template_args {
            if need_comma {
                def.push_str(", ");
            }
            // TODO: NonTypeTemplateParameter
            def.push_str(&(String::from("typename ") + &arg.get_name().unwrap()));
            need_comma = true;
        }
        def.push_str(">\n");
    }
}

fn escape_html(s: &str) -> String {
    let mut result = String::new();
    pulldown_cmark::escape::escape_html(&mut result, s).unwrap();
    result
}

fn filter_children<'a, P>(entity: &Entity<'a>, predicate: P) -> Vec<Entity<'a>>
where
    P: FnMut(&&Entity<'a>) -> bool,
{
    entity
        .get_children()
        .iter()
        .filter(predicate)
        .copied()
        .collect()
}

#[allow(dead_code)]
fn dump(entity: &Entity, indent: usize) {
    eprintln!(
        "{}{:?} {:?} {:?}",
        " ".repeat(indent),
        entity.get_kind(),
        entity.get_name(),
        entity.get_display_name()
    );
    for child in entity.get_children() {
        dump(&child, indent + 4);
    }
}

fn parse<'tu>(
    index: &'tu clang::Index<'tu>,
    repo_path: &str,
) -> Result<TranslationUnit<'tu>, anyhow::Error> {
    let mut parser = index.parser(
        repo_path.to_owned() + "/libraries/psibase/common/include/psibase/nativeFunctions.hpp",
    );
    let wasi_sdk_prefix = env::var("WASI_SDK_PREFIX")?;
    parser.arguments(&[
        "-fcolor-diagnostics",
        "-std=c++2a",
        "-c",
        "--target=wasm32-wasi",
        "-fno-exceptions",
        "-nostdlib",
        "-nostdinc",
        "-nostdinc++",
        "-nostdlib++",
        "-DCOMPILING_CONTRACT",
        "-DCOMPILING_WASM",
        &("-I".to_owned() + &wasi_sdk_prefix + "/share/wasi-sysroot/include/c++/v1"),
        &("-I".to_owned() + &wasi_sdk_prefix + "/share/wasi-sysroot/include"),
        &("-I".to_owned() + &wasi_sdk_prefix + "/lib/clang/13.0.0/include"),
        &("-I".to_owned() + repo_path + "/build/wasm/boost"),
        &("-I".to_owned() + repo_path + "/build/wasm/deps/include"),
        &("-I".to_owned() + repo_path + "/external/rapidjson/include"),
        &("-I".to_owned() + repo_path + "/external/simdjson/include"),
        &("-I".to_owned() + repo_path + "/libraries/psibase/common/include"),
        &("-I".to_owned() + repo_path + "/libraries/psibase/contract/include"),
        &("-I".to_owned() + repo_path + "/libraries/psio/consthash/include"),
        &("-I".to_owned() + repo_path + "/libraries/psio/include"),
    ]);
    parser.skip_function_bodies(true);
    parser.keep_going(true);
    Ok(parser.parse()?)
}

fn modify_book(book: &mut mdbook::book::Book, re: Regex, mut items: Vec<Item>) {
    for item in book.iter() {
        match item {
            BookItem::Chapter(chapter) => {
                for capture in re.captures_iter(&chapter.content) {
                    let path = capture.get(1).unwrap().as_str();
                    set_urls(chapter, &mut items, path);
                }
            }
            BookItem::Separator => (),
            BookItem::PartTitle(_) => (),
        }
    }
    book.for_each_mut(|item: &mut BookItem| match item {
        BookItem::Chapter(chapter) => {
            chapter.content = fill_all_links(&chapter.content, &items, 0);
        }
        BookItem::Separator => (),
        BookItem::PartTitle(_) => (),
    });
    book.for_each_mut(|item: &mut BookItem| match item {
        BookItem::Chapter(chapter) => {
            chapter.content = re
                .replace_all(&chapter.content, |caps: &Captures| {
                    let path = caps.get(1).unwrap().as_str();
                    generate_documentation(&items, path)
                })
                .to_string();
        }
        BookItem::Separator => (),
        BookItem::PartTitle(_) => (),
    });
}

fn main() -> Result<(), anyhow::Error> {
    let re = Regex::new(r"[{][{] *#cpp-doc +(::[^ ]+)+ *[}][}]").unwrap();
    let args = Args::parse();
    if args.command.is_some() {
        return Ok(());
    }

    let (ctx, mut book) = CmdPreprocessor::parse_input(io::stdin())?;
    let mut path = ctx.root;
    path.push("../..");
    let repo_path = path.to_str().unwrap();

    let clang = clang::Clang::new().unwrap();
    let index = clang::Index::new(&clang, false, true);
    let tu = parse(&index, repo_path)?;
    // dump(&tu.get_entity(), 0);
    let items = get_items(&tu);
    modify_book(&mut book, re, items);
    serde_json::to_writer(io::stdout(), &book)?;
    Ok(())
}
