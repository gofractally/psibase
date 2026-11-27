//! `psibase key`: make a private key and show it in the forms that the
//! other commands and other tools read.
//!
//! A secp256k1 private key is written as WIF, the one-line form that
//! Bitcoin tools use (`psibase::wif`). `--pem` gives the PKCS #8 PEM form
//! that OpenSSL reads instead.

use crate::{
    generate_k1_private_key, k1_private_key_pem, load_k1_private_key, public_key_pem, wif_encode,
    AnyPrivateKey, WifKey,
};
use anyhow::{Context, Error};
use clap::Subcommand;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;

#[derive(Subcommand, Debug)]
pub enum KeyCommand {
    /// Create a new secp256k1 private key
    ///
    /// The key is printed in WIF, the one-line base58 form that Bitcoin
    /// tools read (K... or L...). Everywhere a psibase command takes a
    /// key, it takes this string or a file that holds it: `-s FILE` signs
    /// with it and `-k FILE` names its public key. Keep it in a file
    /// (`-o FILE`); a key typed on a command line stays in the shell's
    /// history.
    Generate {
        /// Write the key as a PKCS #8 PEM document (the form OpenSSL
        /// reads) instead of WIF
        #[clap(long)]
        pem: bool,

        /// Write the key to this file, which must not exist, readable by
        /// its owner only, instead of printing it
        #[clap(short = 'o', long, value_name = "FILE")]
        output: Option<PathBuf>,
    },

    /// Show a key in another form
    ///
    /// Prints the public key of KEY as a PEM document. KEY is a private
    /// key in any form that `--sign` takes: WIF or a file holding it, a
    /// PEM or DER file, or a PKCS #11 URI.
    Show {
        /// The private key
        key: String,

        /// Print the private key instead of the public key, in WIF. Only
        /// secp256k1 keys have that form. The string starts with K or L
        /// if the key signs for its compressed public key and with 5 if
        /// it signs for the uncompressed one, as KEY does.
        #[clap(long)]
        private: bool,

        /// With --private, print the private key as a PKCS #8 PEM
        /// document instead of WIF
        #[clap(long, requires = "private")]
        pem: bool,
    },
}

fn private_text(key: &WifKey, pem: bool) -> Result<String, Error> {
    if pem {
        k1_private_key_pem(key)
    } else {
        Ok(wif_encode(&key.secret, key.compressed, key.network)? + "\n")
    }
}

fn write_private(path: &Path, text: &str) -> Result<(), Error> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("Cannot create {}", path.display()))?;
    file.write_all(text.as_bytes())?;
    Ok(())
}

pub fn handle_cli_key_cmd(command: &KeyCommand) -> Result<(), Error> {
    match command {
        KeyCommand::Generate { pem, output } => {
            let text = private_text(&generate_k1_private_key(), *pem)?;
            match output {
                Some(path) => {
                    write_private(path, &text)?;
                    eprintln!("Wrote a new private key to {}", path.display());
                }
                None => print!("{}", text),
            }
            if !*pem {
                eprintln!(
                    "The key is in WIF. For the PEM form: psibase key show --private --pem KEY"
                );
            }
        }
        KeyCommand::Show { key, private, pem } => {
            if *private {
                print!("{}", private_text(&load_k1_private_key(key)?, *pem)?);
            } else {
                let key = AnyPrivateKey::from_str(key)?;
                print!("{}", public_key_pem(&key.claim().rawData));
            }
        }
    }
    Ok(())
}
