#pragma once

#include <psibase/DefaultTestChain.hpp>
#include "FractallySys.hpp"

using namespace psibase;
using UserContract::FractallySys;

class FractallyChainHelper {
public: 
   static void chainWithFractal(DefaultTestChain &t, psibase::test_chain::ContractUser<UserContract::FractallySys> f) {
      f.init();
      f.createFractal("firstfractal"_a, std::string("FirstFractal"), std::string("Our mission is important"), std::string("en"), std::string("Americas"));
   };
   static void chainWith1Team(DefaultTestChain &t,
                              psibase::AccountNumber founder) {
      // auto f = t.as(t.add_account("founder"_a)).at<FractallySys>();
      auto f = t.as(founder).at<FractallySys>();
      chainWithFractal(t, f);
      auto a = t.add_account("alice"_a);
      auto b = t.add_account("bob"_a);
      auto c = t.add_account("carol"_a);
      f.inviteMember(a);
      f.inviteMember(b);
      f.inviteMember(c);
      std::vector<psibase::AccountNumber> teamMembers = {founder, a, b, c};
      f.createTeam(teamMembers, "Team1");
   };
   static void chainWithACouncil(DefaultTestChain &t, std::array<psibase::AccountNumber, 3> councilMembers) {
      // auto f = t.as(t.add_account("founder"_a)).at<FractallySys>();
      auto councilMember1 = councilMembers.at(0);
      auto c1 = t.as(councilMember1).at<FractallySys>();
      chainWith1Team(t, councilMember1);

      auto councilMember2 = councilMembers.at(1);
      auto c2 = t.as(councilMember2).at<FractallySys>();
      auto d = t.add_account("dylan"_a);
      auto e = t.add_account("eva"_a);
      auto f = t.add_account("fred"_a);
      auto councilMember3 = councilMembers.at(2);
      auto c3 = t.as(councilMember3).at<FractallySys>();
      auto g = t.add_account("greg"_a);
      auto h = t.add_account("heather"_a);
      auto i = t.add_account("igor"_a);
      c1.inviteMember(d);
      c1.inviteMember(e);
      c1.inviteMember(f);
      c1.inviteMember(g);
      c1.inviteMember(h);
      c1.inviteMember(i);
      std::vector teamMembers2 = {councilMember2, d, e, f};
      c2.createTeam(teamMembers2, "Team2");
      std::vector teamMembers3 = {councilMember3, g, h, i};
      c3.createTeam(teamMembers3, "Team3");
   };
};
