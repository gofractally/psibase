import { AccountSelection } from "./components/AccountSelection";
import { Nav } from "./components/nav";

function App() {
  return (
    <div className="w-full mx-auto max-w-screen-lg">
      <Nav />
      <AccountSelection />
    </div>
  );
}

export default App;
