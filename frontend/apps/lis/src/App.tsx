// import { useState } from 'react'
// import heroImg from './assets/hero.png'
// import reactLogo from './assets/react.svg'
// import viteLogo from './assets/vite.svg'
// import './App.css'

// function App() {
//   const [count, setCount] = useState(0)

//   return (
//     <>
//       <section id="center">
//         <div className="hero">
//           <img src={heroImg} className="base" width="170" height="179" alt="" />
//           <img src={reactLogo} className="framework" alt="React logo" />
//           <img src={viteLogo} className="vite" alt="Vite logo" />
//         </div>
//         <div>
//           <h1>Get started</h1>
//           <p>
//             Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
//           </p>
//         </div>
//         <button
//           type="button"
//           className="counter"
//           onClick={() => setCount((count) => count + 1)}
//         >
//           Count is {count}
//         </button>
//       </section>

//       <div className="ticks"></div>

//       <section id="next-steps">
//         <div id="docs">
//           <svg className="icon" role="presentation" aria-hidden="true">
//             <use href="/icons.svg#documentation-icon"></use>
//           </svg>
//           <h2>Documentation</h2>
//           <p>Your questions, answered</p>
//           <ul>
//             <li>
//               <a href="https://vite.dev/" target="_blank">
//                 <img className="logo" src={viteLogo} alt="" />
//                 Explore Vite
//               </a>
//             </li>
//             <li>
//               <a href="https://react.dev/" target="_blank">
//                 <img className="button-icon" src={reactLogo} alt="" />
//                 Learn more
//               </a>
//             </li>
//           </ul>
//         </div>
//         <div id="social">
//           <svg className="icon" role="presentation" aria-hidden="true">
//             <use href="/icons.svg#social-icon"></use>
//           </svg>
//           <h2>Connect with us</h2>
//           <p>Join the Vite community</p>
//           <ul>
//             <li>
//               <a href="https://github.com/vitejs/vite" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#github-icon"></use>
//                 </svg>
//                 GitHub
//               </a>
//             </li>
//             <li>
//               <a href="https://chat.vite.dev/" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#discord-icon"></use>
//                 </svg>
//                 Discord
//               </a>
//             </li>
//             <li>
//               <a href="https://x.com/vite_js" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#x-icon"></use>
//                 </svg>
//                 X.com
//               </a>
//             </li>
//             <li>
//               <a href="https://bsky.app/profile/vite.dev" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#bluesky-icon"></use>
//                 </svg>
//                 Bluesky
//               </a>
//             </li>
//           </ul>
//         </div>
//       </section>

//       <div className="ticks"></div>
//       <section id="spacer"></section>
//     </>
//   )
// }

// export default App

import { useEffect, useState } from 'react'
import { getLisResults } from './api/lis'
import type { LisResult } from './types/lis'
import './App.css'

function App() {
  const [results, setResults] = useState<LisResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadResults() {
      try {
        const data = await getLisResults({
          limit: 10,
          offset: 0,
          signal: controller.signal,
        })

        if (!controller.signal.aborted) {
          setResults(data.items)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Không thể tải dữ liệu từ LIS.'
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadResults()

    return () => controller.abort()
  }, [])

  return (
    <main className="app-container">
      <header className="page-header">
        <h1>Hệ thống thông tin xét nghiệm – LIS</h1>
        <p>Danh sách kết quả xét nghiệm từ hệ thống LIS</p>
      </header>

      <section className="results-section">
        <h2>Danh sách kết quả xét nghiệm</h2>

        {loading && <p>Đang tải dữ liệu...</p>}

        {error && (
          <p className="error-message">{error}</p>
        )}

        {!loading && !error && (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Mã kết quả</th>
                    <th>Mã bệnh nhân</th>
                    <th>Xét nghiệm</th>
                    <th>Giá trị</th>
                    <th>Thời điểm</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>

                <tbody>
                  {results.map((result) => (
                    <tr key={result.result_id}>
                      <td>{result.result_id}</td>
                      <td>{result.patient_id}</td>
                      <td>{result.test_name}</td>
                      <td>
                        {result.value_num} {result.unit ?? ''}
                      </td>
                      <td>
                        {result.effective_at
                          .slice(0, 16)
                          .replace('T', ' ')} UTC
                      </td>
                      <td>
                        <span className="status-badge">
                          {result.result_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {results.length === 0 && (
              <p>Không có kết quả xét nghiệm.</p>
            )}

            <p className="results-count">
              Đang hiển thị {results.length} kết quả.
            </p>
          </>
        )}
      </section>
    </main>
  )
}

export default App
