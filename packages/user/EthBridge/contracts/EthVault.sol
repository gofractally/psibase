// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Fixed 2-of-3 custody. Anyone may execute signed batches or claim allocated ETH.
/// No upgrades, owner sweep, arbitrary calls, gas reimbursement or key rotation.
contract EthVault {
    uint256 private constant UNIT = 10 gwei;
    address[3] public signers;
    bytes32 public deployment;
    uint256 public nextBatch;
    uint256 public nextDeposit = 1;
    uint256 public allocated;
    mapping(address => uint256) public claimable;
    bool private entered;
    event Configured(bytes32 deployment, uint256 chainId, address signer0, address signer1, address signer2);
    event Deposit(uint64 id, uint64 recipient, uint64 amountUnits);
    event BatchExecuted(uint256 nonce, bytes32 paymentsHash, uint64 totalUnits);
    event Claimed(address recipient, uint256 amountWei);
    modifier locked() { require(!entered, "reentrant"); entered=true; _; entered=false; }
    constructor(bytes32 identity, address[3] memory keys) {
        require(identity!=bytes32(0), "identity");
        for(uint256 i=0;i<3;i++) {
            require(keys[i]!=address(0), "zero signer");
            for(uint256 j=0;j<i;j++) require(keys[i]!=keys[j], "duplicate signer");
        }
        deployment=identity; signers=keys;
        emit Configured(identity, block.chainid, keys[0], keys[1], keys[2]);
    }
    function deposit(uint64 recipient) external payable {
        require(recipient!=0 && msg.value>0 && msg.value%UNIT==0 && msg.value/UNIT<=type(uint64).max,"deposit units");
        require(nextDeposit<=type(uint64).max,"deposit ids exhausted");
        emit Deposit(uint64(nextDeposit++), recipient, uint64(msg.value/UNIT));
    }
    function digest(uint256 nonce, bytes32 paymentsHash) public view returns(bytes32) {
        bytes32 domain=keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"),
            keccak256("PsibaseETHBridge"),keccak256("1"),block.chainid,address(this),deployment));
        return keccak256(abi.encodePacked(hex"1901",domain,keccak256(abi.encode(keccak256("Batch(uint256 nonce,bytes32 paymentsHash)"),nonce,paymentsHash))));
    }
    function execute(uint256 nonce,address[] calldata recipients,uint64[] calldata amounts,bytes[] calldata signatures) external locked {
        require(nonce==nextBatch && recipients.length>0 && recipients.length<=32 && recipients.length==amounts.length && signatures.length==2,"batch shape");
        bytes memory packed; uint64 total;
        for(uint256 i=0;i<recipients.length;i++) {
            require(recipients[i]!=address(0)&&recipients[i]!=address(this)&&amounts[i]>0,"payment");
            packed=bytes.concat(packed,bytes20(recipients[i]),bytes8(amounts[i])); total+=amounts[i];
        }
        bytes32 paymentsHash=keccak256(packed);bytes32 message=digest(nonce,paymentsHash);address previous;
        for(uint256 i=0;i<2;i++) {
            bytes calldata signature=signatures[i]; require(signature.length==65,"signature size");
            bytes32 r;bytes32 s;uint8 v;
            assembly {r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64)))}
            require(uint256(s)<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v==27||v==28),"signature canonicality");
            address signer=ecrecover(message,v,r,s);require(signer>previous && (signer==signers[0]||signer==signers[1]||signer==signers[2]),"signature authority");previous=signer;
        }
        uint256 value=uint256(total)*UNIT;require(address(this).balance>=allocated+value,"unallocated reserve");
        nextBatch++;allocated+=value;
        for(uint256 i=0;i<recipients.length;i++) claimable[recipients[i]]+=uint256(amounts[i])*UNIT;
        emit BatchExecuted(nonce,paymentsHash,total);
    }
    /// Funds always go to the signed recipient, regardless of who pays claim gas.
    function claimFor(address payable recipient) external locked {
        uint256 value=claimable[recipient];require(value>0,"nothing allocated");
        claimable[recipient]=0;allocated-=value;
        (bool ok,)=recipient.call{value:value}("");require(ok,"recipient rejected ETH");
        emit Claimed(recipient,value);
    }
}
