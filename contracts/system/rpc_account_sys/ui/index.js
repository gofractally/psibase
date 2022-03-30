'use strict';

const table = document.getElementById('accounts');
const tbody = table.getElementsByTagName('tbody')[0];

(async () => {
    const accounts = await (await fetch('/accounts')).json();
    for (let acc of accounts) {
        let row = tbody.insertRow(-1);
        row.insertCell().appendChild(document.createTextNode(acc.num + ''));
        row.insertCell().appendChild(document.createTextNode(acc.name));
        row.insertCell().appendChild(document.createTextNode(acc.auth_contract_name));
        row.insertCell().appendChild(document.createTextNode(acc.flags + ''));
        row.insertCell().appendChild(document.createTextNode(acc.code_hash));
    }
})()

function msg(m) {
    document.getElementById('messages').innerText = m;
}

async function createAccount() {
    try {
        const name = document.getElementById('name').value;
        const authContract = document.getElementById('authContract').value;
        const actionResponse = await fetch('/pack/create_account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, authContract, allowSudo: false })
        });
        if (!actionResponse.ok)
            throw new Error(await actionResponse.text());
        const action = await actionResponse.json();
        msg(JSON.stringify(action, null, 4));
    } catch (e) {
        console.error(e);
        msg(e.message);
    }
}
