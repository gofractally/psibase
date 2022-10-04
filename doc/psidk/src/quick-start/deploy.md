# deploy

## Creating your service account
- Go to the [Accounts](http://psibase.127.0.0.1.sslip.io:8080/applet/account-sys) applet, login as `alice` or `bob` by selecting them 
- Enter `counter` as the account name
- Enter a private key or generate one and make sure it's written down and press `Create Account`. 

## Generating our service and applet
To get kicked off we'll build a applet and service from a pre-built template in `/generator` directory. `(/root/psibase/generator)`

```
cd generator
yarn
yarn run generate
```

Select `React` naming the account `counter`
Run `yarn run generate` again and select Contract this time with the same account `counter`. 

Navigate to the new directory `/services/user/Counter` and run the `./deploy.sh` file following the prompts. 

Afterwards go to the `/ui` folder and run `yarn && yarn run build` to set up the frontend then run `./deploy.sh` script as well.

Now we have built both the service and the applet and deployed each one. 

Applets are available at `/applet/*service name*` so lets go to [/applet/counter](http://psibase.127.0.0.1.sslip.io:8080/applet/counter) to review ours. 

Enter a number above 100 and you'll see the count increase, this is automatically..

- Authenticated as `alice` or `bob`
