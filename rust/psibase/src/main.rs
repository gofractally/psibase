use clap::{Parser, Subcommand};

/// Interact with a running psinode
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint
    #[clap(
        short = 'a',
        long,
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/"
    )]
    api: String,

    #[clap(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Install a contract
    Install {
        /// Account to install contract on
        account: String,

        /// Filename containing the contract
        filename: String,

        /// Create the account if it doesn't exist. The account won't be secured;
        /// anyone can authorize as this account without signing. Caution: this option
        /// should not be used on production or public chains.
        #[clap(short = 'i', long)]
        create_insecure_account: bool,

        /// Register the contract with proxy_sys. This allows the contract to host a
        /// website, serve RPC requests, and serve GraphQL requests.
        #[clap(short = 'p', long)]
        register_proxy: bool,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _args = Args::parse();

    Ok(())
}
