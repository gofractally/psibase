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
   /**
    * Controls whether caching operations should log debug information.
    * Used primarily in read operations and cache management to track:
    * - Cache hit/miss patterns
    * - Cache update timing
    * - Cache state changes
    */
   static constexpr bool debug_cache = false;

   /**
    * Enables validation of structural invariants throughout the codebase.
    * Used in:
    * - binary_node operations - Verifies node structure and key ordering
    * - tree operations - Ensures tree balance and connectivity
    * - data structure validation - Checks internal consistency
    * This is a fundamental debugging flag that helps maintain data structure integrity.
    */
   static constexpr bool debug_invariant = false;

   /**
    * Enables debug logging for root node operations.
    * Used in database operations to track:
    * - Root node modifications
    * - Tree structure changes
    * - Database state transitions
    * Particularly useful for debugging database consistency issues.
    */
   static constexpr bool debug_roots = false;

   /**
    * Enables comprehensive memory operation validation and tracking.
    * Used extensively throughout the codebase:
    * - read_lock::alloc() - Validates allocation state and prevents double allocation
    * - object_ref operations - Verifies checksums and validates memory moves
    * - seg_allocator - Tracks segment compaction and memory management
    * - node operations - Ensures proper memory boundaries and layout
    * - binary_node operations - Validates memory operations during node modifications
    * 
    * This is a critical debugging flag for catching memory-related issues and 
    * ensuring proper memory management throughout the system.
    */
   static constexpr bool debug_memory = false;

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
