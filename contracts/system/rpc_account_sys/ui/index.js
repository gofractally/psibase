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
