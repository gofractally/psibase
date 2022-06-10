'use strict';

let contracts = ['account-sys', 'explore-sys', 'token-sys'];

for (let contract of contracts)
{
   let ul = document.getElementById('contracts');
   let li = document.createElement('li');
   let a  = document.createElement('a');
   a.appendChild(document.createTextNode(contract));
   a.href = siblingUrl(null, contract);
   li.appendChild(a);
   ul.appendChild(li);
}
