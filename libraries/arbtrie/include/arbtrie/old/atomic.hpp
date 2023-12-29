#pragma once 

namespace triedent {

   template<typename T>
   struct atom {
      atom( auto v ):value(v){}
      T fetch_add( T d, auto ) { auto old = value; value += d; return old; }
      T fetch_sub( T d, auto ) { auto old = value; value -= d; return old; }

      bool compare_exchange_weak( T& expect, T val ) {
         if( value == expect ) {
            value = val;
            return true;
         }
         else 
            expect = value;
         return false;
      }
      bool compare_exchange_weak( T& expect, T val, auto ) {
         if( value == expect ) {
            value = val;
            return true;
         }
         else 
            expect = value;
         return false;
      }

      void store( T v, auto) { value = v; }
      void store( T v) { value = v; }
      T load(auto)const{ return value; }
      T load()const{ return value; }
      T value;
   };

};
