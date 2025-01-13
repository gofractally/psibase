import { Workshop } from "./components/Workshop";
import { Nav } from "./components/nav";

function App() {
  return (
    <div className="w-full mx-auto max-w-screen-lg">
      <Nav />
      <Workshop />
    </div>
  );
}

export default App;
