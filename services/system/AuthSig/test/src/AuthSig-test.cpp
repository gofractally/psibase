#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/VerifySig.hpp>
#include <services/user/Nft.hpp>

using namespace SystemService;
using namespace UserService;
using namespace psibase;

namespace
{
   auto pubFromPem = [](std::string param) {  //
      return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)};
   };

   auto privFromPem = [](std::string param) {  //
      return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)};
   };

   auto pub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto priv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
       "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
       "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
       "-----END PRIVATE KEY-----\n");

   //{"data": {"userNfts":{"edges":[{"node":{"id":2,"issuer":"alice","owner":"alice"}}]}}}
   struct Node
   {
      uint32_t      id;
      AccountNumber issuer;
      AccountNumber owner;
   };
   PSIO_REFLECT(Node, id, issuer, owner);

   struct Edge
   {
      Node node;
   };
   PSIO_REFLECT(Edge, node);

   struct UserNfts
   {
      std::vector<Edge> edges;
   };
   PSIO_REFLECT(UserNfts, edges);

   struct Data
   {
      UserNfts userNfts;
   };
   PSIO_REFLECT(Data, userNfts);

   struct QueryRoot
   {
      Data data;
   };
   PSIO_REFLECT(QueryRoot, data);

}  // namespace

size_t getNrNfts(DefaultTestChain& chain, AccountNumber user)
{
   auto query = GraphQLBody{
       "query UserNfts { userNfts( user: \"alice\" ) { edges { node { id issuer owner } } } }"};

   auto res = chain.post(Nft::service, "/graphql", query);

   auto body          = std::string(res.body.begin(), res.body.end());
   auto response_root = psio::convert_from_json<QueryRoot>(body);

   //psibase::writeConsole(psio::format_json(response_root));

   return response_root.data.userNfts.edges.size();
}

// Checksum256 calc_txid(DefaultTestChain& chain, uint32_t id, std::vector<Action> actions)
// {
//    // auto query =
//    //     GraphQLBody{"query GetStagedTx { getStagedTx(id: " + std::to_string(id) + ") { id, proposeBlock, txid } }"};

//    auto query = GraphQLBody{
//        "query GetAllStaged { getAllStaged { edges { node { id, txid, proposeBlock, "
//        "proposer } } } }"};

//    auto res  = chain.post(StagedTxService::service, "/graphql", query);
//    auto body = std::string(res.body.begin(), res.body.end());
//    psibase::writeConsole(body);
//    psibase::writeConsole("\n");

//    return {};
// }

// Tx can be staged on behalf of an account using auth-sig
// Tx is executed once the staged tx sender accepts it
// Tx is deleted without execution once tx sender rejects it
SCENARIO("AuthSig")
{
   GIVEN("Regular chain")
   {
      DefaultTestChain t;

      KeyList keys  = {{pub, priv}};
      auto    alice = t.from(t.addAccount("alice"_a)).with(keys);
      t.setAuth<AuthSig::AuthSig>(alice.id, pub);
      auto bob = t.from(t.addAccount("bob"_a));

      auto mintAction = Action{.sender  = alice.id,
                               .service = Nft::service,
                               .method  = "mint"_m,
                               .rawData = psio::to_frac(std::tuple())

      };
      auto proposed   = std::vector<Action>{mintAction};

      THEN("Alice has not minted any NFTs")
      {
         CHECK(getNrNfts(t, alice.id) == 0);
      }
      THEN("Alice can self-stage a tx, which auto-executes")
      {
         auto propose = alice.to<StagedTxService>().propose(proposed);
         REQUIRE(propose.succeeded());
         REQUIRE(getNrNfts(t, alice.id) == 1);
      }
      THEN("Bob can stage a tx for alice, which does not auto-execute")
      {
         auto propose = bob.to<StagedTxService>().propose(proposed);
         REQUIRE(propose.succeeded());
         REQUIRE(getNrNfts(t, alice.id) == 0);
      }
      WHEN("Bob stages a tx for alice")
      {
         auto id   = bob.to<StagedTxService>().propose(proposed).returnVal();
         auto txid = bob.to<StagedTxService>().get_staged_tx(id).returnVal().txid;

         THEN("Alice can accept it, executing it")
         {
            auto accept = alice.to<StagedTxService>().accept(id, txid);
            REQUIRE(accept.succeeded());
            REQUIRE(getNrNfts(t, alice.id) == 1);
         }
         THEN("Alice can reject it, deleting it")
         {
            auto reject = alice.to<StagedTxService>().reject(id, txid);
            REQUIRE(reject.succeeded());
            REQUIRE(getNrNfts(t, alice.id) == 0);
            REQUIRE(alice.to<StagedTxService>().get_staged_tx(id).failed("Unknown staged tx"));
         }
      }
   }
}