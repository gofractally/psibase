#include <cstdlib>
#include <psibase/check.hpp>
#include <typeinfo>

extern "C" void* __cxa_allocate_exception(std::size_t sz) throw()
{
   return std::malloc(sz);
}

extern "C" void __cxa_throw(void* except, std::type_info* tinfo, void (*)(void*))
{
   psibase::abortMessage(tinfo->name());
}
