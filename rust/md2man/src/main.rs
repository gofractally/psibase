use clap::Parser;
use pulldown_cmark::{Event, HeadingLevel, Options, Tag};
use std::io;
use std::io::Write;
use std::iter::Iterator;

enum State {
    Default,
    Item,
}

fn md2man<'a, S: Write, I: Iterator<Item = Event<'a>>>(
    out: &mut S,
    iter: &mut I,
    date: &str,
) -> io::Result<()> {
    let mut stack: Vec<&str> = vec![];
    let mut current = "\\fR";
    stack.push(current);
    let mut state = State::Default;
    let mut indent = 0;
    let mut par_num = 0;
    for item in iter {
        match item {
            Event::Start(t) => match t {
                Tag::Paragraph => {
                    current = &"\\fR";
                    match state {
                        State::Item => {
                            if par_num == 1 {
                                write!(out, "\n")?;
                            }
                            if par_num > 1 {
                                write!(out, "\n.IP\n")?;
                            }
                            par_num += 1;
                        }
                        _ => {
                            write!(out, "\n.PP\n")?;
                        }
                    }
                }
                Tag::Heading(level, _fragment, _classes) => {
                    current = "\\fR";
                    match level {
                        HeadingLevel::H1 => {
                            write!(out, ".TH ")?;
                        }
                        HeadingLevel::H2 => {
                            write!(out, "\n.SH ")?;
                        }
                        HeadingLevel::H3 => {
                            write!(out, "\n.SS ")?;
                        }
                        _ => {
                            write!(out, "\n.PP\n")?;
                        }
                    }
                }
                Tag::CodeBlock(_kind) => {
                    write!(out, "\n.PP\n.in +4n\n.EX\n")?;
                }
                Tag::List(_n) => match state {
                    State::Item => {
                        write!(out, "\n.RS")?;
                    }
                    _ => {}
                },
                Tag::Item => {
                    if &current != &"\\fR" {
                        write!(out, "\\fR")?;
                        current = &"\\fR";
                    }
                    indent += 1;
                    match state {
                        State::Item => {
                            write!(out, "\n.IP \\(bu 2\n")?;
                        }
                        _ => {
                            state = State::Item;
                            par_num = 0;
                            write!(out, "\n.TP\n")?;
                        }
                    }
                }
                Tag::Emphasis => {
                    stack.push(&"\\fI");
                }
                Tag::Strong => {
                    stack.push(&"\\fB");
                }
                _ => {}
            },
            Event::End(t) => match t {
                Tag::Heading(level, _fragment, _classes) => match level {
                    HeadingLevel::H1 => {
                        write!(out, " 1 \"{date}\" psibase \"Psibase User's Manual\"\n")?;
                    }
                    HeadingLevel::H2 | HeadingLevel::H3 => {
                        write!(out, "\n")?;
                    }
                    _ => {
                        write!(out, ":\n")?;
                    }
                },
                Tag::CodeBlock(_kind) => {
                    write!(out, "\n.EE\n.in\n")?;
                }
                Tag::List(_n) => match state {
                    State::Item => {
                        write!(out, "\n.RE\n")?;
                    }
                    _ => {}
                },
                Tag::Item => {
                    indent -= 1;
                    if indent == 0 {
                        state = State::Default;
                    }
                }
                Tag::Emphasis => {
                    stack.pop();
                }
                Tag::Strong => {
                    stack.pop();
                }
                _ => {}
            },
            Event::Text(s) => {
                let format = stack[stack.len() - 1].clone();
                if format != current {
                    write!(out, "{}", format)?;
                    current = format;
                }
                write!(out, "{s}")?;
            }
            Event::Code(s) => {
                if &current != &"\\fB" {
                    write!(out, "\\fB")?;
                    current = &"\\fB";
                }
                write!(out, "{s}")?;
            }
            Event::SoftBreak => {
                write!(out, "\n")?;
            }
            Event::HardBreak => {
                write!(out, "\n.br\n")?;
            }
            _ => {}
        }
    }

    write!(out, "\n")?;

    Ok(())
}

#[derive(clap::Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    #[clap(short = 'd', long, value_name = "DATE", default_value = "")]
    date: String,
}

fn main() -> io::Result<()> {
    let args = Args::parse();
    let input = io::read_to_string(io::stdin())?;
    md2man(
        &mut io::stdout(),
        &mut pulldown_cmark::Parser::new_ext(&input, Options::all()),
        &args.date,
    )?;
    Ok(())
}
