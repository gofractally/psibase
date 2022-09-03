# Action Scripts

- [What are action scripts](#what-are-action-scripts)
- [Use case](#use-case)
  - [Example](#example)
- [Security](#security)
  - [Application groups](#application-groups)
  - [Future extension outside application groups](#future-extension-outside-application-groups)
- [Atomicity](#atomicity)

## What are action scripts

In most blockchains, every function called on an on-chain smart-contract is called a "transaction." In some other blockchains, calling a function on chain requires one "action," and a "transaction" may be comprised of one or many such actions. On these chains, a transaction can be viewed as a kind of "script" with one very basic functionality: execute an ordered list of actions.

In Psibase, this concept of a script has been further generalized, and is known as an "Action Script". Transactions in psibase blockchains may contain a list of actions, but some actions may themselves be scripts written to execute an ordered list of other actions. Such scripts are called Action Scripts. What differentiates Action Scripts from regular actions? Action scripts enable intelegent, dynamic transactions that act from the perspective of the user rather than the perspective of an application. Regular actions may only execute inline actions as the running application, whereas an action called from an Action Script appears to originate from the user.

## Use case

An applet may pack several actions into a single transaction to execute one overall user-initiated operation. But consider the case where the intermediate value of one action is required as a parameter for a subsequent action. Without Action Scripts, it would be required that the execution of this operation be split into two separate transactions, and the client would need to read the intermediate state from the chain before submitting the second transaction.

In Psibase blockchains, an Action Script may be written to bundle all the actions together as inline-actions. Intermediate state or return values of prior actions can be read and fed into subsequent actions within the Action Script, and all inline actions executed may run as the user, as though they were submitted as part of an overall transaction.

### Example

Consider an applet that wants to create a new token with a symbol. A user is presented with a form that lets them select the properties of the new token, the name of the symbol, and a button labeled, "Create."

To accomplish this, the following steps would be required:
1. create@token-sys: Create a new token
2. Look up the nft created by the token contract that represents ownership of the new token
3. debit@nft-sys: Debit the token nft
4. Look up how much a new symbol costs
5. credit@token-sys: Send the cost of a new symbol to the symbol contract
6. create@symbol-sys: Tell the symbol contract to create a new symbol (it will debit the tokens sent in the previous step)
7. Look up the NFT generated that represents the ownership of the new symbol
8. debit@nft-sys: Debit the symbol NFT
9. credit@nft-sys: Transfer the symbol NFT back to the symbol contract
10. Look up the ID of the newly created token
11. mapToken@symbol: Map the symbol to the new token ID

Notice that the lookup in steps 2 and 7 each require that prior actions were completed, and are required to run the rest of the actions in this sequence. Regardless of any arrangement of these actions and operations, the minimum number of transactions required to run this sequence without Action Scripts would be 2. The second transaction could not even be constructed until the first one completed. This delay means various user errors could result in partial execution of the sequence, leaving the user with a token without a symbol, or a symbol without a token.

With Action Scripts, the entire sequence can be shrunk down to:
1. Look up how much a new symbol costs
2. credit@token-sys: Send the cost of a new symbol to the symbol contract
3. create@symbol-sys: Create a new symbol
4. createAndMap@tokenSys: Creates a new token, and map it to the newly created symbol

This sequence contains only three actions which can be fit in a single transaction which will execute atomically. 

To implement the createAndMap@tokenSys Action Script, the c++ code would be significantly simpler, due to the ability to receive action return values.

```cpp
// tokenSys.cpp (pseudocode)

void TokenSys::createAndMap(Precision p, Quantity maxSupply, SID symbolId)
{
    // Create new token, and give ownership to sender
    auto tid = create(p, maxSupply);
    auto tokenNft = getToken(tid).ownerNft;
    senderAt<NftSys>().debit(tokenNft, "Debit token ownership NFT");

    // Create new symbol
    auto cost = at<SymbolSys>().getCost(symbolId.str().size());
    senderAt<SymbolSys>().create(symbolId, cost);
    auto symbolNft = at<SymbolSys>().getSymbol(symbolId).ownerNft;
    senderAt<NftSys>().debit(symbolNft, "Take ownership of new symbol");

    // Map symbol to token
    senderAt<NftSys>().credit(symbolNft, SymbolSys::contract, "Give symbol to symbol-sys");
    senderAt<SymbolSys>().mapToken(tid, symbolId);
}

```

## Security

Action Scripts are able to run inline actions as the user. In order to prevent Action Scripts from using other applications on behalf of a user without their permission, the user is required to submit the list of applications that the Action Script is permitted to use on their behalf when they submit an Action Script in a transaction. If the Action Script attempts to call an inline action as the user on an application that was not explicitly specified, it will fail the entire transaction.

### Application groups

What applications is the user allowed to specify when calling an Action Scripts? If a user could specify anything, then malicious front-ends may be able to trick users into signing an Action Script that acts on their behalf in ways that the user didn't expect (and wouldn't permit).

But if an Action Script could only run actions in its own Application, then its usefulness would be severely limited. To address this, Psibase blockchains have a capability similar to that provided in [other operating systems](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_application-groups), called "Application Groups." 

If two or more applications each identify as part of the same application group, then these applications can be trusted by each other, as though they were all part of a single larger application. An Action Script is therefore not only permitted to operate on its own application, but also on any application with whom it shares an application group, as long as the user explicitly specifies each of the required applications when constructing the Action Script.

### Future extension outside application groups

In the future, it may be possible to allow end users to be prompted for permission if an Action Script wants access to applications outside of its application group. Due to the implications of allowing such a capability, it's currently not provided until Action Scripts are deemed sufficiently usable and secure.

## Atomicity

Action Scripts allow application developers to provide a special interface to applets that abstract the complexity of running transactions that contain actions dependent on the state update generated by the successful execution of prior actions.

The ability to run such sequences atomically means that they will all fail or succeed together, ensuring that the user is not left in a partially completed state. Action Scripts therefore reduce errors and increase developer and user experience.
