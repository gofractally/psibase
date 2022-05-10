#include <trie/trie.hpp>
#include <vector>
#include <iostream>

using namespace trie::raw;

int main( int argc, char** argv ) {

   std::vector<char> arena_data(palloc::system_page_size * 1024);
   auto              ar = new (arena_data.data()) palloc::arena(arena_data.size());
   trie::trie        tr( *ar );

   tr.upsert( "a", "one" );
   tr.upsert( "b", "two" );
   tr.upsert( "c", "three" );
   tr.upsert( "d", "four" );
   tr.upsert( "e", "five" );
   tr.upsert( "f", "six" );

   return 0;
   {
   std::vector<char> arena_data(palloc::system_page_size * 1024);
   auto              ar = new (arena_data.data()) palloc::arena(arena_data.size());

   auto hello = leaf::make( *ar, "hello world" );
   std::cout << hello->value() <<"\n";
   std::cout << hello->reference_count() <<"\n";

   std::cout << "hello pos: " << hello <<"\n";

   auto root = inner::make( *ar, "prefix", 4 );
   std::cout << "root->max_children(): " << root->max_children() <<"\n";
   std::cout << "root->num_children(): " << root->num_children() <<"\n";
   std::cout << "root->prefix(): " << root->prefix() <<"\n";

   auto goodbye = leaf::make( *ar, "goodbye" );
   auto moon = leaf::make( *ar, "moon" );
   auto root_anext = inner::make( *ar, "next", 4 );

   root->set_child('a', goodbye);
   auto fetch_ch = *root->child('a');
   std::cout << fetch_ch->as_leaf()->value() <<"\n";
   std::cout <<" \n=========== setting moon\n";
   root->set_child('a', moon);
   fetch_ch = *root->child('a');
   std::cout << "a = moon? : " <<(*root->child('a'))->as_leaf()->value() <<"\n";
   std::cout << "a = moon? : " <<(*root->child('a'))->as_leaf()->value().size() <<"\n";


   std::cout << "''" <<leaf::make( *ar, "" )->value().size()<<"\n";
   std::cout << "'1'" <<leaf::make( *ar, "1" )->value().size()<<"\n";
   std::cout << "'12'" <<leaf::make( *ar, "12" )->value().size()<<"\n";
   std::cout << "'123'" <<leaf::make( *ar, "123" )->value().size()<<"\n";
   std::cout << "'1234'" <<leaf::make( *ar, "1234" )->value().size()<<"\n";
   std::cout << "'12345'" <<leaf::make( *ar, "12345" )->value().size()<<"\n";
   std::cout << "'123456'" <<leaf::make( *ar, "123456" )->value().size()<<"\n";
   std::cout << "'1234567'" <<leaf::make( *ar, "1234567" )->value().size()<<"\n";
   std::cout << "'12345678'" <<leaf::make( *ar, "12345678" )->value().size()<<"\n";

   std::cout << "''" <<leaf::make( *ar, "" )->capacity()<<"\n";
   std::cout << "'1'" <<leaf::make( *ar, "1" )->capacity()<<"\n";
   std::cout << "'12'" <<leaf::make( *ar, "12" )->capacity()<<"\n";
   std::cout << "'123'" <<leaf::make( *ar, "123" )->capacity()<<"\n";
   std::cout << "'1234'" <<leaf::make( *ar, "1234" )->capacity()<<"\n";
   std::cout << "'12345'" <<leaf::make( *ar, "12345" )->capacity()<<"\n";
   std::cout << "'123456'" <<leaf::make( *ar, "123456" )->capacity()<<"\n";
   std::cout << "'1234567'" <<leaf::make( *ar, "1234567" )->capacity()<<"\n";
   std::cout << "'12345678'" <<leaf::make( *ar, "12345678" )->capacity()<<"\n";

   std::cout << "global: " << base::global_base_count() <<"\n";
   }
   std::cout << "leaving scope: " << base::global_base_count() <<"\n";

   /// this only works if "pat" is an iner..

   // TODO: Finish implimenting free fucntion add_child( arena, inner, ...)
//   auto new_root = add_child( *ar, *root, "path", hello );

   return 0;
}
