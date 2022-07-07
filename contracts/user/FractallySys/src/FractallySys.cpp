#include "FractallySys.hpp"
// #include "symbol_sys.hpp"
#include "FractallyErrors.hpp"

#include <contracts/system/AccountSys.hpp>
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

void FractallySys::createFractal(psio::const_view<psibase::String> name) {
   // db.open<FractalTable_t>().put(token);
}
void FractallySys::inviteMember(psibase::AccountNumber account) {
}
void FractallySys::createTeam(const std::vector<psibase::AccountNumber> &members,
                  psibase::AccountNumber acct) {

   at<AccountSys>().newAccount(acct, "auth-fake-sys"_a, true);
   check(at<AccountSys>().exists(acct), invalidAccount);

   db.open<TeamTable_t>().put(TeamRecord{
       .account        = acct,      //
       .lead  = acct,      //
       .rankRollingTotal = 0,  //
       .earningsRollingTotal = 0,   //
       .weeksOnCouncil = 0   //
   });
}
void FractallySys::proposeSchedule(WhatType dayOfWeek, WhatType frequency) {
   return;
}
void FractallySys::confSchedule() {
   return;
}
PSIBASE_DISPATCH(UserContract::FractallySys)