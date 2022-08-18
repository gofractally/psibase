import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import './App.css'
import { Person } from './person';
// @ts-ignore
import { initializeApplet } from '/common/rpc.mjs'

console.log(initializeApplet, 'was initializeApplet')
// const siblingUrl = window.siblingUrl;

function App() {
  const [count, setCount] = useState(0)

  useEffect(() => {

    initializeApplet()

  }, [])

  return (
    <div className="App">
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://reactjs.org" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1 className='derp' style={{ backgroundColor: 'red' }}>Vite + React</h1>
      <div className="card">
        {['john', 'brandon', 'mike'].map(name => <Person key={name} name={name} />)}
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </div>
  )
}

export default App
