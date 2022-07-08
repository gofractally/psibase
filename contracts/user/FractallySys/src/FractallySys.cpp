#include "FractallySys.hpp"
// #include "symbol_sys.hpp"
#include "FractallyErrors.hpp"

#include <contracts/system/AccountSys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <contracts/system/commonErrors.hpp>
#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace UserContract::Errors;
using namespace psibase;
using psio::const_view;
using system_contract::AccountSys;
// using TokenHolderConfig = typename TokenHolderRecord::Configurations;

// For helpers
#include <concepts>
#include <limits>
namespace { }  // namespace

FractallySys::FractallySys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   // if (m != MethodNumber{"init"})
   // {
   //    auto initRecord = db.open<InitTable_t>().getIndex<0>().get(SingletonKey{});
   //    check(initRecord.has_value(), uninitialized);
   // }
}

void FractallySys::init() {}

void FractallySys::createFractal(psibase::AccountNumber acct,
                                 std::string name,
                                 std::string mission,
                                 std::string language,
                                 std::string timezone) {
   auto fractalsTable = db.open<FractalsTable_t>();
   check(fractalsTable.getIndex<0>().get(acct).has_value(), fractalAlreadyExists);
   fractalsTable.put(FractalRecord{
       .account        = acct,
       .name  = name,
       .mission = mission,
       .language = language,
       .timezone = timezone,
       .creationDate = at<system_contract::TransactionSys>().headBlockTime()
   });
}
void FractallySys::inviteMember(psibase::AccountNumber account) {
}
void FractallySys::createTeam(const std::vector<psibase::AccountNumber> &members,
                  psibase::AccountNumber acct) {

   check(acct != AccountSys::nullAccount, invalidAccount);
   check(!at<AccountSys>().exists(acct), accountAlreadyExists);
   at<AccountSys>().newAccount(acct, "auth-fake-sys"_a, true);
   
   auto teamTable = db.open<TeamTable_t>();
   check(teamTable.getIndex<0>().get(acct).has_value(), teamAlreadyExists);
   teamTable.put(TeamRecord{
       .account        = acct,
       .lead  = acct,
       .rankRollingTotal = 0,
       .earningsRollingTotal = 0,
       .weeksOnCouncil = 0,
       .creationDate = at<system_contract::TransactionSys>().headBlockTime()
   });
}
void FractallySys::proposeSchedule(WhatType dayOfWeek, WhatType frequency) {
   return;
}
void FractallySys::confSchedule() {
   return;
}
PSIBASE_DISPATCH(UserContract::FractallySys)