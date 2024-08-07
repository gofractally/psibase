use anyhow::{anyhow, Error};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use url::Url;

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Read the config file
    Read,

    /// Manages Hosts config: they are api endpoint aliases
    #[command(subcommand)]
    Host(HostSubCommand),
}

#[derive(Subcommand, Debug)]
pub enum HostSubCommand {
    /// Setup a host environment alias in the config file ~/.psibase.toml
    /// to be deployed. Example: dev, prod.
    Set {
        /// Host key. Example: dev, prod, qa1, uat, etc.
        key: String,

        /// Host URL. Example: https://prod.my-psibase-app.io
        url: Url,
    },

    /// Delete a host environment alias from the config file ~/.psibase.toml
    Delete {
        /// Host key. Example: dev, prod, qa1, uat, etc.
        key: String,
    },

    /// List all the hosts in the config file
    List,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct PsibaseConfig {
    pub hosts: HashMap<String, String>,
}

pub fn handle_cli_config_cmd(config: &ConfigCommand) -> Result<(), anyhow::Error> {
    match config {
        ConfigCommand::Host(host_opts) => handle_host_subcommand(host_opts),
        ConfigCommand::Read => {
            println!("{}", get_psibase_config_str()?);
            Ok(())
        }
    }
}

fn handle_host_subcommand(host_opts: &HostSubCommand) -> Result<(), anyhow::Error> {
    match host_opts {
        HostSubCommand::Set { key, url } => setup_config_host(key, url),
        HostSubCommand::Delete { key } => remove_config_host(key),
        HostSubCommand::List => {
            let config = read_psibase_config().expect("No hosts config found in ~/.psibase.toml");
            println!("{:?}", config.hosts);
            Ok(())
        }
    }
}

fn psibase_config_path() -> Result<PathBuf, Error> {
    // TODO: watch https://github.com/rust-lang/libs-team/issues/372
    let home = std::env::var("HOME")?;
    let path = Path::new(&home).join(".psibase.toml");
    Ok(path)
}

pub fn get_psibase_config_str() -> Result<String, Error> {
    let path = psibase_config_path()?;
    let config_str = std::fs::read_to_string(&path)?;
    Ok(config_str)
}

pub fn parse_psibase_config_str(config_str: &str) -> Result<PsibaseConfig, Error> {
    toml::from_str::<PsibaseConfig>(config_str).map_err(Error::from)
}

pub fn read_psibase_config() -> Option<PsibaseConfig> {
    get_psibase_config_str()
        .ok()
        .map(|cfg| parse_psibase_config_str(&cfg).ok())
        .flatten()
}

pub fn write_psibase_config(config: PsibaseConfig) -> Result<(), Error> {
    let path = psibase_config_path()?;
    let config_str = toml::to_string(&config)?;
    std::fs::write(path, config_str)?;
    Ok(())
}

pub fn read_host_config_url(host_key: &str) -> Result<String, Error> {
    let psibase_config = read_psibase_config().expect(
        r#"No hosts config found in ~/.psibase.toml
    
Make sure you have the psibase config file setup properly. 

You can do that by running `cargo psibase config host dev=http://my-dev-env.example.com`

Or manually editing the ~/.psibase.toml:

[hosts]
prod = "https://prod.example.com"
dev = "https://dev.example.com"
qa1 = "https://qa1.example.com""#,
    );

    match psibase_config.hosts.get(host_key) {
        Some(host_url) => Ok(host_url.to_string()),
        None => Err(anyhow!(
            "Host {} not found in ~/.psibase.toml; Available hosts: {}",
            host_key,
            psibase_config
                .hosts
                .keys()
                .map(|k| k.to_string())
                .collect::<Vec<String>>()
                .join(", ")
        )),
    }
}

pub fn setup_config_host(key: &str, url: &Url) -> Result<(), Error> {
    let mut config = read_psibase_config().unwrap_or_default();
    config.hosts.insert(key.to_string(), url.to_string());
    write_psibase_config(config)
}

pub fn remove_config_host(key: &str) -> Result<(), Error> {
    let mut config = read_psibase_config().expect("No hosts config found in ~/.psibase.toml");
    if config.hosts.get(key).is_none() {
        return Err(anyhow!("Host {} not found in ~/.psibase.toml", key));
    } else {
        config.hosts.remove(key);
        write_psibase_config(config)
    }
}
