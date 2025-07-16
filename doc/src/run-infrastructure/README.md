# Running infrastructure

Psibase networks are made possible by those who choose to run infrastructure on behalf of the community. Running infrastructure means participating in ensuring the independence of your community by helping to host its apps for everyone.

## Ways to run infrastructure

There are two primary ways to install psibase infrastructure:

1. Download native binaries on a Linux server
2. Install docker and download the associated psibase docker images

Once you have completed either of these two methods, you should be able to run psibase and psinode commands, either natively or through a docker container. If you have reached that point, then you can proceed to the [CLI documentation](./cli/README.md) for more information about how to use these tools to manage a psibase network.

### Native binaries

Check the psibase reference implementation [releases](https://github.com/gofractally/psibase/releases) page and download the `psidk-*.tar.gz` artifact onto your server.

The `psidk` package contains the necessary CLI binaries (`psinode` and `psibase`) to launch and manage an instance of a psibase node.

### Docker images

Follow the official instructions for installing the Docker engine on your server. Then pull the latest psinode image from the [github container registry](https://github.com/orgs/gofractally/packages).

For more information about using the psibase/psinode docker images, see the [image-builders](https://github.com/gofractally/image-builders) repository.

