'use client';

import { useState } from 'react';
import { LAYOUT_ENGINES } from './docs-content';
import { Check } from 'lucide-react';

export function EngineCompare() {
  const [activeEngineId, setActiveEngineId] = useState<
    'dagre' | 'elk' | 'tala'
  >('dagre');

  const engine =
    LAYOUT_ENGINES.find((e) => e.id === activeEngineId) || LAYOUT_ENGINES[0];

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden my-6">
      {/* Top Segmented Control (Next.js style) */}
      <div className="flex flex-wrap items-center justify-between border-b border-gray-200 bg-gray-50/70 px-4 py-2.5 gap-2">
        <div className="text-xs font-semibold text-gray-900">
          Layout Engine Visualizer
        </div>

        <div className="flex items-center bg-gray-200/70 p-0.5 rounded-md">
          {LAYOUT_ENGINES.map((eng) => (
            <button
              key={eng.id}
              type="button"
              onClick={() => setActiveEngineId(eng.id)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                activeEngineId === eng.id
                  ? 'bg-white text-gray-900 shadow-xs font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {eng.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: SVG Diagram Preview */}
        <div className="lg:col-span-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">
                Topology Preview
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-700 border border-gray-200">
                {engine.badge}
              </span>
            </div>

            <div className="relative aspect-[4/3] w-full rounded-md bg-[#fafafa] border border-gray-200 p-4 flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(#0000000f_1px,transparent_1px)] [background-size:16px_16px]" />

              {/* Dagre */}
              {activeEngineId === 'dagre' && (
                <svg
                  viewBox="0 0 400 300"
                  className="w-full h-full relative z-10"
                >
                  <rect
                    x="150"
                    y="25"
                    width="100"
                    height="40"
                    rx="4"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="200"
                    y="49"
                    fill="#171717"
                    fontSize="12"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Web Client
                  </text>

                  <rect
                    x="150"
                    y="105"
                    width="100"
                    height="40"
                    rx="4"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="200"
                    y="129"
                    fill="#171717"
                    fontSize="12"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    API Gateway
                  </text>

                  <rect
                    x="70"
                    y="185"
                    width="110"
                    height="40"
                    rx="4"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="125"
                    y="209"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Auth Service
                  </text>

                  <rect
                    x="220"
                    y="185"
                    width="110"
                    height="40"
                    rx="4"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="275"
                    y="209"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Order Service
                  </text>

                  <rect
                    x="150"
                    y="250"
                    width="100"
                    height="35"
                    rx="4"
                    fill="#f5f5f5"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="200"
                    y="272"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    PostgreSQL DB
                  </text>

                  <line
                    x1="200"
                    y1="65"
                    x2="200"
                    y2="105"
                    stroke="#171717"
                    strokeWidth="1.5"
                    markerEnd="url(#dagre-arrow)"
                  />
                  <line
                    x1="175"
                    y1="145"
                    x2="125"
                    y2="185"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="225"
                    y1="145"
                    x2="275"
                    y2="185"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="125"
                    y1="225"
                    x2="180"
                    y2="250"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="275"
                    y1="225"
                    x2="220"
                    y2="250"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />

                  <defs>
                    <marker
                      id="dagre-arrow"
                      viewBox="0 0 10 10"
                      refX="5"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#171717" />
                    </marker>
                  </defs>
                </svg>
              )}

              {/* ELK */}
              {activeEngineId === 'elk' && (
                <svg
                  viewBox="0 0 400 300"
                  className="w-full h-full relative z-10"
                >
                  <rect
                    x="40"
                    y="60"
                    width="90"
                    height="42"
                    rx="4"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="85"
                    y="85"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Web Client
                  </text>

                  <rect
                    x="40"
                    y="160"
                    width="90"
                    height="42"
                    rx="4"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="85"
                    y="185"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Mobile App
                  </text>

                  <rect
                    x="170"
                    y="110"
                    width="90"
                    height="50"
                    rx="4"
                    fill="#f5f5f5"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="215"
                    y="139"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    API Gateway
                  </text>

                  <rect
                    x="290"
                    y="50"
                    width="90"
                    height="38"
                    rx="4"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="335"
                    y="73"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Auth Svc
                  </text>

                  <rect
                    x="290"
                    y="115"
                    width="90"
                    height="38"
                    rx="4"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="335"
                    y="138"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Order Svc
                  </text>

                  <rect
                    x="290"
                    y="180"
                    width="90"
                    height="38"
                    rx="4"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="335"
                    y="203"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Payment Svc
                  </text>

                  <path
                    d="M 130 81 L 150 81 L 150 125 L 170 125"
                    fill="none"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M 130 181 L 150 181 L 150 145 L 170 145"
                    fill="none"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />

                  <path
                    d="M 260 125 L 275 125 L 275 69 L 290 69"
                    fill="none"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M 260 135 L 290 135"
                    fill="none"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M 260 145 L 275 145 L 275 199 L 290 199"
                    fill="none"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                </svg>
              )}

              {/* TALA */}
              {activeEngineId === 'tala' && (
                <svg
                  viewBox="0 0 400 300"
                  className="w-full h-full relative z-10"
                >
                  <rect
                    x="130"
                    y="30"
                    width="245"
                    height="235"
                    rx="8"
                    fill="#fbfbfe"
                    stroke="#d4d4d8"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                  <text
                    x="145"
                    y="52"
                    fill="#71717a"
                    fontSize="10"
                    fontWeight="600"
                  >
                    AWS Cloud (us-east-1)
                  </text>

                  <rect
                    x="20"
                    y="125"
                    width="85"
                    height="46"
                    rx="6"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="62"
                    y="152"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Users
                  </text>

                  <rect
                    x="150"
                    y="75"
                    width="95"
                    height="42"
                    rx="6"
                    fill="#ffffff"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="197"
                    y="100"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Gateway
                  </text>

                  <rect
                    x="150"
                    y="145"
                    width="95"
                    height="42"
                    rx="6"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="197"
                    y="170"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Core API
                  </text>

                  <rect
                    x="265"
                    y="145"
                    width="95"
                    height="42"
                    rx="6"
                    fill="#ffffff"
                    stroke="#525252"
                    strokeWidth="1.5"
                  />
                  <text
                    x="312"
                    y="170"
                    fill="#262626"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    Workers
                  </text>

                  <rect
                    x="200"
                    y="212"
                    width="110"
                    height="38"
                    rx="6"
                    fill="#f5f5f5"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <text
                    x="255"
                    y="235"
                    fill="#171717"
                    fontSize="11"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    Aurora DB
                  </text>

                  <line
                    x1="105"
                    y1="148"
                    x2="150"
                    y2="96"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="197"
                    y1="117"
                    x2="197"
                    y2="145"
                    stroke="#171717"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="245"
                    y1="166"
                    x2="265"
                    y2="166"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="197"
                    y1="187"
                    x2="235"
                    y2="212"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="312"
                    y1="187"
                    x2="275"
                    y2="212"
                    stroke="#737373"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </div>
          </div>

          <div className="mt-2 text-[11px] text-gray-500">
            Same D2 input yields different spatial coordinates depending on
            layout algorithm objectives.
          </div>
        </div>

        {/* Right: Engine Specs */}
        <div className="lg:col-span-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-base font-bold text-gray-900">
                {engine.name}
              </h4>
              <span className="text-[11px] font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {engine.availability}
              </span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-4">
              {engine.summary}
            </p>

            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-1.5">
                  Characteristics
                </div>
                <ul className="space-y-1">
                  {engine.characteristics.map((c, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-600 flex items-start gap-2"
                    >
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-1.5">
                  Recommended For
                </div>
                <ul className="space-y-1">
                  {engine.bestFor.map((b, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-600 flex items-start gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
            <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block">
                Edge Crossings
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {engine.crossingMinimization}
              </span>
            </div>
            <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block">
                Compile Latency
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {engine.performance}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
