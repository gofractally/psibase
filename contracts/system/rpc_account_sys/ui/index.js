import { postJsonGetJson, pushedSignedTransaction } from '/common/rpc.mjs';

const table = document.getElementById('accounts');
const tbody = table.getElementsByTagName('tbody')[0];

(async () => {
    const accounts = await (await fetch('/accounts')).json();
    for (let acc of accounts) {
        let row = tbody.insertRow(-1);
        row.insertCell().appendChild(document.createTextNode(acc.num + ''));
        row.insertCell().appendChild(document.createTextNode(acc.auth_contract));
        row.insertCell().appendChild(document.createTextNode(acc.flags + ''));
        row.insertCell().appendChild(document.createTextNode(acc.code_hash));
    }
})()

function clearMsg() {
    document.getElementById('messages').innerText = '';
}

function msg(m) {
    document.getElementById('messages').innerText += m + '\n';
}

async function createAccount() {
    try {
        clearMsg();
        msg("Packing action...");
        const account = document.getElementById('account').value;
        const authContract = document.getElementById('authContract').value;
        const action = await postJsonGetJson('/pack/create_account', { account, authContract, allowSudo: false });

        msg("Pushing transaction...");
        const signedTrx = {
            // TODO: TAPOS
            // TODO: Sign
            trx: {
                tapos: {
                    expiration: new Date(Date.now() + 10_000),
                },
                actions: [action],
            },
        };
        const trace = await pushedSignedTransaction(signedTrx);

        msg(JSON.stringify(trace, null, 4));
    } catch (e) {
        console.error(e);
        msg(e.message);
        if (e.trace)
            msg('trace: ' + JSON.stringify(e.trace, null, 4));
    }
}

document.querySelector('#createAccount').addEventListener('click', createAccount)
