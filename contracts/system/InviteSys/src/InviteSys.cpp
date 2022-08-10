#include <contracts/system/AccountSys.hpp>
#include <contracts/system/InviteSys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace system_contract;

//void InviteSys::checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims)
//{
// Todo - move to AuthInviteSys
// Todo logic
/*
        If the transaction contains acceptInvite, 
            check it's the only action in the transaction
        Else 
            Forward the checkAuthSys
    */
//}

void InviteSys::acceptInvite(psibase::AccountNumber name,
                             psibase::AccountNumber authContract,
                             psibase::PublicKey     payload)
{
   check(getSender() == InviteSys::payerAccount,
         "Only " + InviteSys::payerAccount.str() + " can create new accounts");
   at<AccountSys>().newAccount(name, authContract, true);

   Actor<AuthInterface> auth(AccountSys::contract, authContract);
   auth.newAccount(name, payload);
}

PSIBASE_DISPATCH(system_contract::InviteSys)