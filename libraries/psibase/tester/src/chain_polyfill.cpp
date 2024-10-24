#include <psibase/RawNativeFunctions.hpp>
#include <psibase/testerApi.hpp>

using namespace psibase;
using std::uint32_t;

namespace psibase::tester::raw
{
   extern uint32_t getSelectedChain();
}  // namespace psibase::tester::raw

uint32_t psibase::raw::getResult(const char* dest, uint32_t destSize, uint32_t offset)
{
   return psibase::tester::raw::getResult(dest, destSize, offset);
}

uint32_t psibase::raw::getKey(const char* dest, uint32_t destSize)
{
   return psibase::tester::raw::getKey(dest, destSize);
}

void psibase::raw::abortMessage(const char* message, uint32_t len)
{
   return psibase::tester::raw::abortMessage(message, len);
}

void psibase::raw::writeConsole(const char* message, uint32_t len)
{
   ::write(1, message, len);
}

// PSIBASE_NATIVE(getCurrentAction) uint32_t getCurrentAction();
// PSIBASE_NATIVE(call) uint32_t call(const char* action, uint32_t len);
// PSIBASE_NATIVE(setRetval) void setRetval(const char* retval, uint32_t len);
// PSIBASE_NATIVE(kvPut)
// void kvPut(DbId db, const char* key, uint32_t keyLen, const char* value, uint32_t valueLen);
// PSIBASE_NATIVE(putSequential)
// uint64_t putSequential(DbId db, const char* value, uint32_t valueLen);
// PSIBASE_NATIVE(kvRemove) void kvRemove(DbId db, const char* key, uint32_t keyLen);

uint32_t psibase::raw::kvGet(DbId db, const char* key, uint32_t keyLen)
{
   return psibase::tester::raw::kvGet(psibase::tester::raw::getSelectedChain(), db, key, keyLen);
}

uint32_t psibase::raw::getSequential(DbId db, uint64_t id)
{
   return psibase::tester::raw::getSequential(psibase::tester::raw::getSelectedChain(), db, id);
}

uint32_t psibase::raw::kvGreaterEqual(DbId        db,
                                      const char* key,
                                      uint32_t    keyLen,
                                      uint32_t    matchKeySize)
{
   return psibase::tester::raw::kvGreaterEqual(psibase::tester::raw::getSelectedChain(), db, key,
                                               keyLen, matchKeySize);
}

uint32_t psibase::raw::kvLessThan(DbId db, const char* key, uint32_t keyLen, uint32_t matchKeySize)
{
   return psibase::tester::raw::kvLessThan(psibase::tester::raw::getSelectedChain(), db, key,
                                           keyLen, matchKeySize);
}

uint32_t psibase::raw::kvMax(DbId db, const char* key, uint32_t keyLen)
{
   return psibase::tester::raw::kvMax(psibase::tester::raw::getSelectedChain(), db, key, keyLen);
}

void psibase::raw::kvPut(DbId        db,
                         const char* key,
                         uint32_t    keyLen,
                         const char* value,
                         uint32_t    valueLen)
{
   psibase::tester::raw::kvPut(psibase::tester::raw::getSelectedChain(), db, key, keyLen, value,
                               valueLen);
}

// PSIBASE_NATIVE(setMaxTransactionTime) void setMaxTransactionTime(uint64_t ns);
