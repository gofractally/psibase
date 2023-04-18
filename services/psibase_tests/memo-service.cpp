#include <psibase/Memo.hpp>
#include <psibase/dispatch.hpp>

#include <psio/from_json.hpp>

using namespace psibase;
using namespace psio;

struct MemoService
{
   std::string testValue(Memo memo) { return memo.contents; }
   std::string testView(view<const Memo> memo) { return memo.contents(); }
   void        testJson(const std::string& data) { psio::convert_from_json<Memo>(data); }
   void        testConstruct(const std::string& data) { Memo{data}; }
};
PSIO_REFLECT(MemoService,
             method(testValue, memo),
             method(testView, memo),
             method(testJson, memo),
             method(testConstruct, memo))

PSIBASE_DISPATCH(MemoService)
