#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <psio/reflect.hpp>
#include <psio/fracpack.hpp>
#include <psio/schema.hpp>
#include <iostream>

#include <psio/from_bin/varint.hpp>
#include <psio/from_json/varint.hpp>
#include <psio/json/any.hpp>
#include <psio/to_bin/varint.hpp>
#include <psio/to_json/varint.hpp>

#include <psio/bytes/from_json.hpp>
#include <psio/bytes/to_json.hpp>
#include <psio/to_json/map.hpp>
#include <psio/translator.hpp>


struct sync_call_proxy {
   sync_call_proxy( uint32_t s, uint32_t r ):sender(s),receiver(r){}

   uint32_t sender;
   uint32_t receiver;

   template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
   auto call( Args&&... args )const {
      std::cout <<"call sender: " << sender <<"  receiver: "<< receiver <<"\n";
//      (std::cout<< ... << args);

      using member_class = decltype(psio::class_of_member(MemberPtr));
      using param_tuple = decltype( psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
      using arg_var = decltype(psio::tuple_to_variant(psio::get_tuple_args(psio::reflect<member_class>::member_pointers())));
      
      /// construct tuple from args as defined by MemberPtr and constructed from args
      /// serialize... dispatch... read result as shared_view_ptr<>
      return psio::shared_view_ptr<arg_var>( arg_var(std::in_place_index_t<idx>(), param_tuple(args..., 999999)) );
   }
};


struct myobj {
   std::string hello;
   std::vector<std::string> hellostr;
   std::optional<std::string> optstr;
   std::vector<std::optional<std::string>> hellooptstr;
   uint64_t in;
   std::optional<uint64_t> oin;
};
PSIO_REFLECT( myobj, hello, hellostr, optstr, hellooptstr, in, oin );

class contr {
   public:
      int buy( int quantity, psio::const_view<myobj> hi ) { 
    //     base_contract::get_sender();
    //     base_contract::get_receiver();

    //     std::cout << "  buy " << quantity << " " << hi.hello<<"\n";
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
PSIO_REFLECT( //
   contr,
   method(buy, quantity, hi),
   method(sell, quantity, token)
)

   /*
template<typename T>
struct actor : public psio::reflect<T>::template proxy<sync_call_proxy> {
   using base = typename psio::reflect<T>::template proxy<sync_call_proxy>;
   using base::base;

   auto* operator->()const { return this; }
   auto& operator*()const { return *this; }
};
*/



TEST_CASE( "contract_proxy" ) {
  // actor<contr> prox( 1, 2 );
  // auto x = prox.buy( 3, myobj{.hello="world"} );

   contr c;

   psio::translator<contr> tr;

   std::cout << tr.get_json_schema() <<"\n";
   std::cout << tr.get_gql_schema() <<"\n";

   /*
   block_reint( [&](){

   });
   block_reint x; (void)x;


  
   prox.no_reintranc().sell(...)
   auto tmp = prox.no();
   tmp.sell();
   tmp.sell();
   tmp.sell();
   prox.sell();
   */

   // cast to reference to base to set sender/receiver
   //set_sender( c, sender );
   //set_receiver( c, receiver);
   //c.base_contract::set_sender(...)


   /*
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
          //(std::cout<<...<<args);
       });
    });
    */

   /*
   using arg_var = decltype(psio::tuple_to_variant(psio::get_tuple_args(psio::reflect<contr>::member_pointers())));
   arg_var tup;
   tup.x;
   */
}
TEST_CASE( "schema" ) {
  psio::schema apischema;
  apischema.generate<contr>();
  std::cout << "flat schema: " << format_json(apischema) << "\n";

}
