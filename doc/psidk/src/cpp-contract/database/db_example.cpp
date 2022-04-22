
struct Accounts
{
   string   first_name;
   string   last_name;
   uint32_t age;
   uint32_t birthyear;

   // compound index
   static std::tuple full_name() { return {&TableRow::first_name, &TableRow::second_name}; }

   // calculated index
   static key_type death_year(psibase::const_view<TableRow> r) { return r.birthyear() + r.age(); }
};

PSIO_REFLECT(Accounts, first_name, last_name, age, birthyear, full_name, death_year)

struct MyContract : psibase::Contract<MyContract>
{
   using DB = Database<Table<Accounts>("accounts",  //
                                       Ordered(first_name),
                                       Unordered("first_name"),
                                       WriteOnlyOrdered("first_name"),
                                       WriteOnlyUnordered("first_name"))>;

   void myaction()
   {
      shared_view_ptr<Account> av = db<"accounts">().by("first_name").get("dan");
      Account                  a  = ;

      av->age() = new_age;
      db<"accounts">().put(av);
      db<"accounts">().put(a);

      Contract<MyContract>::db<...>()

      auto acnt = db<"accounts">().get("dan");
   }
};







// base class impl below

#define PSIBASE_DATABASE       \
   using psibase::Ordered;     \
   using psibase::Unordered;   \
   using psibase::UnorderedWO; \
   using PsibaseContractDatabase
template <TableName T>
auto& db()
{
   return db(get_receiver());
}

template <TableName T>
static auto& db(AccountNumber n)
{
   DerivedContract::PsibaseContractDatabase... static auto t = tables.at<T>(n);
   return t;
}
