'use strict';

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
        const actionResponse = await fetch('/pack/create_account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ account, authContract, allowSudo: false })
        });
        if (!actionResponse.ok)
            throw new Error(await actionResponse.text());
        const action = await actionResponse.json();
        // msg(JSON.stringify(action, null, 4));

        msg("Packing transaction...");
        const signedTrx = {
            // TODO: TAPOS
            // TODO: Sign
            trx: {
                expiration: new Date(Date.now() + 10_000),
                actions: [action],
            },
        };
        const trxResponse = await fetch('/roothost/pack/signed_transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(signedTrx)
        });
        if (!trxResponse.ok)
            throw new Error(await trxResponse.text());
        const packed = await trxResponse.arrayBuffer();

        msg("Pushing transaction...");
        const pushResponse = await fetch('/native/push_transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: packed
        });
        if (!pushResponse.ok)
            throw new Error(await pushResponse.text());
        const trace = await pushResponse.json();
        msg(JSON.stringify(trace, null, 4));
    } catch (e) {
        console.error(e);
        msg(e.message);
    }
}
