#include <psibase/dispatch.hpp>
#include "../include/services/user/Violet.hpp"
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/check.hpp>

using namespace Violet;
using namespace psibase;
using namespace std;


struct CounterQuery
{
   auto counter() const
   {
      return Tables{getReceiver()}.open<CounterTable>().getIndex<0>();
   }

};

PSIO_REFLECT(CounterQuery, method(counter))

void VioletService::increment(uint32_t num)
{
   check(num > 100, "must be greater than 100");
   auto table = Tables{getReceiver()}.open<CounterTable>();

   auto idx = table.getIndex<0>();
   CounterRow counterRow = idx.get(getSender()).value_or<CounterRow>({
         .account = getSender(),
         .counter = 0
   });

   counterRow.counter += num;
   table.put(counterRow);
}

optional<HttpReply> VioletService::serveSys(HttpRequest request)
{

   if (auto result = servePackAction<VioletService>(request))
      return result;

   if (auto result = serveContent(request, Tables{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, CounterQuery{}))
      return result;

   return nullopt;
}

void VioletService::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), Tables{getReceiver()});
}


PSIBASE_DISPATCH(Violet::VioletService)