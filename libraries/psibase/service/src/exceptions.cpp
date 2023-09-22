#include <psibase/check.hpp>

extern "C" void* __cxa_allocate_exception(std::size_t sz) throw()
{
   psibase::abortMessage("Exceptions not supported");
}

extern "C" void __cxa_throw(void*, std::type_info*, void (*)(void*))
{
   psibase::abortMessage("Exceptions not supported");
}
