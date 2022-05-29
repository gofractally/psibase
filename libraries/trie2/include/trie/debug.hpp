#pragma once
#include <iomanip>
#include <iostream>

struct scope {
   scope(){
      ++indent();
   }
   ~scope() {
      --indent();
   }
   static int& indent()
   {
      static int i = 0;
      return i;
   }
};

   template <typename... Ts>
   void debug(const char* func, int line, Ts... args)
   {
      auto pre = std::string(func) + ":" + std::to_string(line);
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


