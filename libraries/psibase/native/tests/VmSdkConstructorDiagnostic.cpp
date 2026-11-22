// Diagnostic only: invoke the actual frozen SDK constructor with initialization
// disabled, so its optional chain selector can be compared without host imports.
#include <psibase/NativeVM.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psizam/aot.hpp>
#include <iostream>

struct Options : psibase::NativeVMOptions
{
   static constexpr uint32_t max_func_local_bytes = 1024 * 1024;
   Options() : NativeVMOptions({0xffffffff, 65536, 0xffffffff, 1024 * 1024},
                               psibase::nativeAotCacheFromEnvironment()) {}
};
template<class Profile>
void examine(const psizam::wasm_code& wasm, const char* name)
{
   Options options;
   using B = psizam::backend<std::nullptr_t, Profile, Options>;
   psizam::wasm_code code = wasm;
   B backend(code, nullptr, options);
   psizam::wasm_allocator memory;
   backend.set_wasm_allocator(&memory);
   backend.initialize();
   auto& context = backend.get_context();
   std::cout << name << " params=" << backend.get_module().get_function_type(215).param_types.size()
             << " before=" << unsigned(uint8_t(context.linear_memory()[280668])) << std::endl;
   psizam::detail::stack_manager stack;
   try {
      context.template execute<>(stack, nullptr, psizam::detail::jit_visitor{context},
                                 uint32_t{215}, uint32_t{300000}, uint32_t{7}, uint32_t{0},
                                 uint32_t{1}, uint32_t{0});
   } catch (const std::exception& e) {
      std::cout << name << " constructor stopped at " << e.what() << std::endl;
   }
   std::cout << name << " after=" << unsigned(uint8_t(context.linear_memory()[280668])) << std::endl;
}
int main(int argc, char** argv)
{
   try {
      if (argc != 2) return 2;
      auto code = psizam::read_wasm(argv[1]);
      examine<psizam::jit_profile>(code, "JIT1");
      examine<psizam::jit2>(code, "JIT2");
      examine<psizam::aot_profile>(code, "LLVM_AOT");
      return 0;
   } catch (const std::exception& e) {
      std::cerr << e.what() << '\n'; return 1;
   }
}
