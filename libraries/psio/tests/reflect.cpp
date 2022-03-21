#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <psio/reflect.hpp>
#include <psio/fracpack.hpp>
#include <iostream>


struct sync_call_proxy {
   sync_call_proxy( uint32_t s, uint32_t r ):sender(s),receiver(r){}

   uint32_t sender;
   uint32_t receiver;

   template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
   auto call( Args&&... args )const {
      std::cout <<"call sender: " << sender <<"  receiver: "<< receiver <<"\n";
      (std::cout<< ... << args);

      using member_class = decltype(psio::class_of_member(MemberPtr));
      using param_tuple = decltype( psio::args_as_tuple(MemberPtr));
      using arg_var = decltype(psio::tuple_to_variant(psio::get_tuple_args(psio::reflect<member_class>::member_pointers())));
      
      /// construct tuple from args as defined by MemberPtr and constructed from args
      /// serialize... dispatch... read result as shared_view_ptr<>
      return psio::shared_view_ptr<arg_var>( arg_var(std::in_place_index_t<idx>(), param_tuple(args...)) );
   }
};


class contr {
   public:
      int buy( int quantity, std::string token ) { 
         std::cout << "  buy " << quantity << " " << token <<"\n";
         return 22; 
      }
      int sell( int quantity, int token ) {
         std::cout <<" sell " << quantity << " " << token << "\n";
         return 33;
      }
};


/*
PSIO_REFLECT_PB( contr,
   (buy, 0, quantity, token),
   (sell, 1, quantity, token)
)
*/
PSIO_REFLECT_PB( contr,
   (buy, 0),
   (sell, 1, quantity, token)
)

template<typename T>
struct actor : public psio::reflect<T>::template proxy<sync_call_proxy> {
   using base = typename psio::reflect<T>::template proxy<sync_call_proxy>;
   using base::base;

   auto* operator->()const { return this; }
   auto& operator*()const { return *this; }
};


TEST_CASE( "contract_proxy" ) {
   actor<contr> prox( 1, 2 );
   auto x = prox.sell( 3, 5.3 );

   contr c;
   x->visit( [&]( auto tview ){
      tview->call( [&]( auto... args ){
          std::cout << "args...\n";
          std::cout << "type: " << int(x->type())<<"\n";
          psio::reflect<contr>::get( x->type(), [&]( auto mfun ) {
              using param_tuple = decltype( psio::args_as_tuple(mfun));
              if constexpr ( std::is_same_v<typename decltype(tview)::tuple_type, param_tuple> ) {
                 (c.*mfun)( std::forward<decltype(args)>(args)... );
              }
          });
          (std::cout<<...<<args);
       });
    });

   /*
   using arg_var = decltype(psio::tuple_to_variant(psio::get_tuple_args(psio::reflect<contr>::member_pointers())));
   arg_var tup;
   tup.x;
   */
}
