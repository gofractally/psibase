use tokio::net::TcpListener;
use tokio::net::UnixStream;
//use core::net::SocketAddr;
use reqwest::Url;

pub struct AutoAbort {
    handle: tokio::task::JoinHandle<()>,
}

impl Drop for AutoAbort {
    fn drop(&mut self) {
        self.handle.abort()
    }
}

async fn make_tcp_proxy(
    path: &str,
) -> Result<(tokio::task::JoinHandle<()>, String), anyhow::Error> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = listener.local_addr()?;
    let pathcpy: String = path.into();
    let task = tokio::task::spawn(async move {
        while let Ok((mut client, _)) = listener.accept().await {
            let pathcpy2 = pathcpy.clone();
            tokio::task::spawn(async move {
                if let Ok(mut upstream) = UnixStream::connect(pathcpy2).await {
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
                }
            });
        }
    });

    Ok((task, format!("http://{}", endpoint)))
}

pub async fn apply_proxy(
    builder: reqwest::ClientBuilder,
    proxy: &Option<Url>,
) -> Result<(reqwest::ClientBuilder, Option<AutoAbort>), anyhow::Error> {
    if let Some(url) = proxy {
        if url.scheme() == "unix" {
            let (task, endpoint) = make_tcp_proxy(url.path()).await?;
            return Ok((
                builder.proxy(reqwest::Proxy::http(endpoint)?),
                Some(AutoAbort { handle: task }),
            ));
        } else {
            return Ok((builder.proxy(reqwest::Proxy::http(url.as_str())?), None));
        }
    }
    return Ok((builder, None));
}
