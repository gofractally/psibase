#pragma once
#include <atomic>
#include <iomanip>
#include <iostream>
#include <thread>
//#include <syncstream>
// #undef NDEBUG
#include <cassert>

namespace arbtrie
{
   static constexpr bool debug_cache     = false;
   static constexpr bool debug_invariant = true;
   static constexpr bool debug_roots     = false;
   static constexpr bool debug_memory    = true;

   struct scope
   {
      scope(const scope&) = delete;
      scope() { ++indent(); }
      ~scope() { --indent(); }
      static std::atomic<int>& indent()
      {
         static std::atomic<int> i = 0;
         return i;
      }
   };

   inline const char* thread_name(const char* n = "unset-thread-name")
   {
      static thread_local const char* thread_name = n;
      if (n)
         thread_name = n;
      return thread_name;
   }

   template <typename... Ts>
   void debug(const char* func, int line, Ts... args)
   {
      auto pre = std::string(thread_name()) + " " + std::string(func) + ":" + std::to_string(line);
      std::cerr << std::setw(20) << std::left << pre << " ";
      for (int x = 0; x < 4 * scope::indent(); ++x)
         std::cerr << " ";
      ((std::cerr << std::forward<Ts>(args)), ...);
      std::cerr << "\n";
   }

   inline auto set_current_thread_name(const char* name)
   {
      thread_name(name);
#ifdef __APPLE__
      return pthread_setname_np(name);
#else
      return pthread_setname_np(pthread_self(), name);
#endif
   }

#if 1  //__DEBUG__
#define TRIEDENT_DEBUG(...) arbtrie::debug(__func__, __LINE__, __VA_ARGS__)
#define TRIEDENT_WARN(...) arbtrie::debug(__func__, __LINE__, "\033[31m", __VA_ARGS__, "\033[0m")
#define TRIEDENT_SCOPE arbtrie::scope __sco__##__LINE__;
#else
#define TRIEDENT_DEBUG(...)
#define TRIEDENT_WARN(...)
#define TRIEDENT_SCOPE
#endif

}  // namespace arbtrie
