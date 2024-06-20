#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <string>

struct SubjectiveRow
{
   std::string key;
   std::string value;
};
PSIO_REFLECT(SubjectiveRow, key, value)

using SubjectiveTable = psibase::Table<SubjectiveRow, &SubjectiveRow::key>;

struct SubjectiveService : psibase::Service<SubjectiveService>
{
   using Tables                  = psibase::SubjectiveTables<SubjectiveTable>;
   static constexpr auto service = psibase::AccountNumber{"subjective"};
   static constexpr auto serviceFlags =
       psibase::CodeRow::isSubjective | psibase::CodeRow::allowWriteSubjective;
   void                       write(std::string key, std::string value);
   std::optional<std::string> read(std::string key);

   void abort(std::string key, std::string value, int op);

   void testRFail1(std::string key, bool txBefore, int op);
   void testRFail2(psibase::AccountNumber account, std::string key, int op);
   void testWFail1(std::string key, std::string value);

   std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
};
PSIO_REFLECT(SubjectiveService,
             method(write, key, value),
             method(read, key, value),
             method(abort, key, value, op),
             method(testRFail1, key, txBefore, op),
             method(testRFail2, account, key, op),
             method(testWFail1, key, value),
             method(serveSys, req))
