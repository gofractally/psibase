#pragma once
#include <iomanip>
#include <iostream>
#include <atomic>

struct scope {
   scope(const scope&) = delete;
   scope(){
      ++indent();
   }
   ~scope() {
      --indent();
   }
   static std::atomic<int>& indent()
   {
      static std::atomic<int> i = 0;
      return i;
   }
};

   inline const char* thread_name(const char* n = "default") {
      static thread_local const char* thread_name = n;
      if( n ) thread_name = n;
      return thread_name;
   }

   template <typename... Ts>
   void debug(const char* func, int line, Ts... args)
   {
      auto pre = std::string(thread_name()) +" " +std::string(func) + ":" + std::to_string(line);
      std::cerr << std::setw(20) << std::left << pre <<" ";
      for( int x = 0; x < 4*scope::indent(); ++x )
         std::cerr<<" ";
      ((std::cerr<< std::forward<Ts>(args)),...);
      std::cerr<<"\n";
   }

#if 1 //__DEBUG__
#define DEBUG( ... ) debug(  __func__,  __LINE__,  __VA_ARGS__ )
#define WARN( ... ) debug(  __func__,  __LINE__,  "\033[31m", __VA_ARGS__, "\033[0m" )
#define SCOPE scope __sco__ ## __LINE__;
#else
#define DEBUG( ... )
#define WARN( ... )
#define SCOPE 
#endif 


