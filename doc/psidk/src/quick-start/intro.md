# intro

Deploy your own `psibase` chain and services in 10 minutes!  

## Dependencies
- [Docker](https://www.docker.com/)
- [Visual Studio Code](https://code.visualstudio.com/)
- [VSC Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) 


## Start docker container and VSC environment

After installing all dependencies, clone our [vscode-new-psibase-contract-ubuntu](https://github.com/James-Mart/vscode-new-psibase-contract-ubuntu) repository, following the commands below. 


```sh
git clone https://github.com/James-Mart/vscode-new-psibase-contract-ubuntu psi
```

Open the project in Visual Studio Code run command `Remote-Containers: Rebuild and Reopen in Container` in the [Command Palette](https://code.visualstudio.com/api/ux-guidelines/command-palette)

An empty VSC window will appear, this is binded to a Docker container running in the background. 

## Download and build psibase

Create a new terminal inside VSC by going to the Terminal menu and selecting `New Terminal` or press `CTRL + SHIFT + `\` and run the following command.


```
git clone https://github.com/gofractally/psibase .
mkdir build
```

This will clone the `psibase` repository in the current folder. 

Create a copy of `tasks.json.sample` file in the `.vscode` directory and name it `tasks.json`. 

Upon saving you should immediately notice a series of buttons on the bottom left edge of the VSC window with labels including `+ Build` and `+ Build & Launch local testnet`. 
These will proof useful during your `psibase` deployment experience. 

Press the `+ Build & Launch local testnet` button to begin building the psibase code, this can take awhile so make yourself a coffee.


When finished, you'll see the chain producing blocks. Confirm this by accessing the portal at [psibase.127.0.0.1.sslip.io:8080](http://psibase.127.0.0.1.sslip.io:8080/)
