// Pi Tech Lab, written in SuperAI. GENERATED from super/pitechlab.sasm by scripts/build_program.py: edit the
// assembly, not this file.
//
// SuperAI is the site's graphical language: supers joined by wires, data flowing from outputs into inputs, powered
// by AI engines. super/runtime.js loads this as SuperAI.program (or the visitor's own edited copy):
//
//   orbit.js           builds the site from  sources, titles, merges and bubbles
//   super/nodes.js     lays out the diagram  diagram.supers and diagram.wires (on a first visit)
//   super/project.js   draws the project map project
window.SUPERAI_PROGRAM = {
 "language": "SuperAI 1",
 "name": "Pi Tech Lab",
 "sources": [
  {
   "key": "assess",
   "name": "Evaluate",
   "panel": "tab-assess"
  },
  {
   "key": "journal",
   "name": "Explore",
   "panel": "tab-journal"
  },
  {
   "key": "analytics",
   "name": "Envision",
   "panel": "tab-analytics"
  },
  {
   "key": "lab",
   "name": "Lab",
   "panel": "tab-lab"
  },
  {
   "key": "diagram",
   "name": "Architecture",
   "panel": "tab-diagram"
  },
  {
   "key": "account",
   "name": "Account",
   "panel": null
  }
 ],
 "titles": {
  "byId": {
   "signInNotice": "Why sign in",
   "profileCard": "Research profile",
   "resultsSection": "Assessment results",
   "historyCard": "Your assessments",
   "ownerResetCard": "Reset platform",
   "claimableCard": "piQ held for you"
  },
  "retitle": {
   "assess:Assess a Manuscript": "Assess Manuscripts [Pi]",
   "analytics:Forecast": "Performance",
   "account:SciLM (siM) Assistant": "SciM Assistant"
  },
  "renamed": {
   "analytics:Key numbers": "analytics:Analytics",
   "analytics:Forecast": "analytics:Performance",
   "account:SciLM (siM) Assistant": "account:SciM Assistant",
   "account:siM Assistant": "account:SciM Assistant",
   "assess:ResBD": "assess:RiBD",
   "assess:Assess a Manuscript": "assess:Assess Manuscripts [Pi]",
   "account:Support ScholarPi": "account:Support Pi",
   "lib:Lib group": "lib:Library group"
  }
 },
 "hide": [
  "SciM Assistant"
 ],
 "merges": [
  {
   "source": "journal",
   "title": "Leaderboards",
   "parts": [
    "pi-Index (piX) Leaderboard [Top Papers]",
    "pi-Quotient (piQ) Leaderboard [Top Authors]"
   ]
  },
  {
   "source": "diagram",
   "title": "Architecture",
   "parts": [
    "Overview",
    "Scoring Pipeline in Detail",
    "Stage Reference",
    "CoARA Compliance & Core Pillars"
   ]
  }
 ],
 "bubbles": [
  {
   "title": "Lab",
   "source": "lab",
   "at": {
    "fx": 0.094,
    "fy": 0.168,
    "inSite": [
     0.582,
     0.68
    ]
   },
   "atPhone": {
    "inSite": [
     0.73,
     0.56
    ]
   }
  },
  {
   "title": "Tools",
   "members": [
    "Assess Manuscripts [Pi]"
   ],
   "at": {
    "fx": -0.073,
    "fy": -0.19,
    "inSite": [
     0.414,
     0.372
    ]
   },
   "atPhone": {
    "inSite": [
     0.27,
     0.34
    ]
   }
  },
  {
   "title": "Library",
   "key": "lib",
   "members": [
    "RiBD",
    "The Global Map of Science",
    "Whitepaper",
    "Architecture",
    "Capabilities"
   ],
   "at": {
    "fx": 0.333,
    "fy": -0.19,
    "inSite": [
     0.75,
     0.372
    ]
   },
   "atPhone": {
    "inSite": [
     0.27,
     0.56
    ]
   }
  },
  {
   "title": "Explore",
   "key": "explore",
   "members": [
    "Live",
    "The journal",
    "Leaderboards",
    "Proof-of-Research Ledger Explorer",
    "Recent assessments",
    "Analytics",
    "Performance",
    "Minting Difficulty"
   ],
   "at": {
    "fx": 0.151,
    "fy": -0.19,
    "inSite": [
     0.582,
     0.372
    ]
   },
   "atPhone": {
    "inSite": [
     0.73,
     0.34
    ]
   }
  },
  {
   "title": "Connect",
   "key": "connect",
   "at": {
    "fx": -0.375,
    "fy": -0.223,
    "inSite": [
     0.24,
     0.372
    ]
   },
   "atPhone": {
    "inSite": [
     0.5,
     0.17
    ]
   },
   "members": [
    "Your account",
    "Your assessments",
    "Research profile",
    "piQ held for you",
    "Assessment results",
    "Reset platform",
    "Why sign in",
    "Invite a researcher",
    "Support Pi",
    "Contact us",
    "GitHub"
   ]
  }
 ],
 "diagram": {
  "supers": [
   {
    "id": "hold",
    "kind": "box",
    "desktop": true,
    "hold": true,
    "n": 1000,
    "at": {
     "inSite": [
      0.326,
      0.159,
      0.838,
      0.841
     ]
    }
   }
  ],
  "wires": [
   [
    "main.sync",
    "site.sync"
   ],
   [
    "title.output",
    "site.sync"
   ],
   [
    "site.condition",
    "main.condition"
   ],
   [
    "main.input",
    "site.input"
   ],
   [
    "site.output",
    "main.output"
   ],
   [
    "site.sync",
    "bubble:Connect.sync"
   ],
   [
    "site.sync",
    "hold.sync"
   ],
   [
    "hold.sync",
    "bubble:Tools.sync"
   ],
   [
    "hold.sync",
    "bubble:Explore.sync"
   ],
   [
    "hold.sync",
    "bubble:Library.sync"
   ],
   [
    "bubble:Connect.output",
    "hold.input"
   ],
   [
    "bubble:Tools.output",
    "bubble:Explore.input"
   ],
   [
    "bubble:Explore.output",
    "bubble:Library.input"
   ],
   [
    "bubble:Lab.output",
    "project.input"
   ],
   [
    "bubble:Explore.condition",
    "bubble:Lab.sync"
   ],
   [
    "bubble:Library.condition",
    "project.sync"
   ]
  ]
 },
 "projectAt": {
  "inSite": [
   0.668,
   0.53
  ]
 },
 "live": {
  "source": "/api/live",
  "every": 30,
  "status": "liveStatus",
  "counts": "liveCounts",
  "ago": "ago",
  "inside": "Explore"
 },
 "functions": {
  "percent": {
   "supers": [
    {
     "id": "part",
     "kind": "input"
    },
    {
     "id": "whole",
     "kind": "input"
    },
    {
     "id": "hundred",
     "text": "100"
    },
    {
     "id": "times",
     "text": "×"
    },
    {
     "id": "over",
     "text": "/"
    },
    {
     "id": "round",
     "text": "round"
    },
    {
     "id": "out",
     "kind": "output"
    }
   ],
   "wires": [
    [
     "hundred.output",
     "times.input"
    ],
    [
     "part.output",
     "times.input"
    ],
    [
     "times.output",
     "over.input"
    ],
    [
     "whole.output",
     "over.input"
    ],
    [
     "over.output",
     "round.input"
    ],
    [
     "whole.output",
     "round.condition"
    ],
    [
     "round.output",
     "out.input"
    ]
   ]
  },
  "ago": {
   "supers": [
    {
     "id": "m",
     "kind": "input"
    },
    {
     "id": "one",
     "text": "1"
    },
    {
     "id": "sixty",
     "text": "60"
    },
    {
     "id": "day",
     "text": "1440"
    },
    {
     "id": "lt1",
     "text": "<"
    },
    {
     "id": "lt60",
     "text": "<"
    },
    {
     "id": "ltday",
     "text": "<"
    },
    {
     "id": "now",
     "text": "just now"
    },
    {
     "id": "minw",
     "text": "min ago"
    },
    {
     "id": "mins",
     "text": "+"
    },
    {
     "id": "inh",
     "text": "/"
    },
    {
     "id": "rh",
     "text": "round"
    },
    {
     "id": "hw",
     "text": "h ago"
    },
    {
     "id": "hrs",
     "text": "+"
    },
    {
     "id": "ind",
     "text": "/"
    },
    {
     "id": "rd",
     "text": "round"
    },
    {
     "id": "dw",
     "text": "d ago"
    },
    {
     "id": "days",
     "text": "+"
    },
    {
     "id": "pick"
    },
    {
     "id": "out",
     "kind": "output"
    }
   ],
   "wires": [
    [
     "m.output",
     "lt1.input"
    ],
    [
     "one.output",
     "lt1.input"
    ],
    [
     "lt1.output",
     "now.condition"
    ],
    [
     "m.output",
     "lt60.input"
    ],
    [
     "sixty.output",
     "lt60.input"
    ],
    [
     "m.output",
     "mins.input"
    ],
    [
     "minw.output",
     "mins.input"
    ],
    [
     "lt60.output",
     "mins.condition"
    ],
    [
     "m.output",
     "ltday.input"
    ],
    [
     "day.output",
     "ltday.input"
    ],
    [
     "m.output",
     "inh.input"
    ],
    [
     "sixty.output",
     "inh.input"
    ],
    [
     "inh.output",
     "rh.input"
    ],
    [
     "rh.output",
     "hrs.input"
    ],
    [
     "hw.output",
     "hrs.input"
    ],
    [
     "ltday.output",
     "hrs.condition"
    ],
    [
     "m.output",
     "ind.input"
    ],
    [
     "day.output",
     "ind.input"
    ],
    [
     "ind.output",
     "rd.input"
    ],
    [
     "rd.output",
     "days.input"
    ],
    [
     "dw.output",
     "days.input"
    ],
    [
     "now.output",
     "pick.input"
    ],
    [
     "mins.output",
     "pick.input"
    ],
    [
     "hrs.output",
     "pick.input"
    ],
    [
     "days.output",
     "pick.input"
    ],
    [
     "pick.output",
     "out.input"
    ]
   ]
  },
  "liveStatus": {
   "supers": [
    {
     "id": "enabled",
     "kind": "input"
    },
    {
     "id": "working",
     "kind": "input"
    },
    {
     "id": "off",
     "text": "not"
    },
    {
     "id": "busy",
     "text": "and"
    },
    {
     "id": "manual",
     "text": "Papers are assessed when people submit them."
    },
    {
     "id": "now",
     "text": "Assessing a paper now, found on its own while the site is quiet."
    },
    {
     "id": "idle",
     "text": "Working while idle. When the site is quiet it finds open-access papers and assesses them."
    },
    {
     "id": "pick"
    },
    {
     "id": "out",
     "kind": "output"
    }
   ],
   "wires": [
    [
     "enabled.output",
     "off.input"
    ],
    [
     "off.output",
     "manual.condition"
    ],
    [
     "enabled.output",
     "busy.input"
    ],
    [
     "working.output",
     "busy.input"
    ],
    [
     "busy.output",
     "now.condition"
    ],
    [
     "enabled.output",
     "idle.condition"
    ],
    [
     "manual.output",
     "pick.input"
    ],
    [
     "now.output",
     "pick.input"
    ],
    [
     "idle.output",
     "pick.input"
    ],
    [
     "pick.output",
     "out.input"
    ]
   ]
  },
  "liveCounts": {
   "supers": [
    {
     "id": "today",
     "kind": "input"
    },
    {
     "id": "byself",
     "kind": "input"
    },
    {
     "id": "total",
     "kind": "input"
    },
    {
     "id": "enabled",
     "kind": "input"
    },
    {
     "id": "tw",
     "text": "assessed today"
    },
    {
     "id": "day",
     "text": "+"
    },
    {
     "id": "open",
     "text": "("
    },
    {
     "id": "close",
     "text": "by itself)"
    },
    {
     "id": "n",
     "text": "&"
    },
    {
     "id": "self",
     "text": "+"
    },
    {
     "id": "dot",
     "text": "·"
    },
    {
     "id": "allw",
     "text": "in total"
    },
    {
     "id": "all",
     "text": "+"
    },
    {
     "id": "line",
     "text": "+"
    },
    {
     "id": "out",
     "kind": "output"
    }
   ],
   "wires": [
    [
     "today.output",
     "day.input"
    ],
    [
     "tw.output",
     "day.input"
    ],
    [
     "open.output",
     "n.input"
    ],
    [
     "byself.output",
     "n.input"
    ],
    [
     "n.output",
     "self.input"
    ],
    [
     "close.output",
     "self.input"
    ],
    [
     "enabled.output",
     "self.condition"
    ],
    [
     "dot.output",
     "all.input"
    ],
    [
     "total.output",
     "all.input"
    ],
    [
     "allw.output",
     "all.input"
    ],
    [
     "day.output",
     "line.input"
    ],
    [
     "self.output",
     "line.input"
    ],
    [
     "all.output",
     "line.input"
    ],
    [
     "line.output",
     "out.input"
    ]
   ]
  },
  "add": {
   "supers": [
    {
     "id": "a",
     "kind": "input"
    },
    {
     "id": "b",
     "kind": "input"
    },
    {
     "id": "plus",
     "text": "+"
    },
    {
     "id": "out",
     "kind": "output"
    }
   ],
   "wires": [
    [
     "a.output",
     "plus.input"
    ],
    [
     "b.output",
     "plus.input"
    ],
    [
     "plus.output",
     "out.input"
    ]
   ]
  },
  "explain": {
   "params": [
    "topic"
   ],
   "code": [
    [
     "push",
     "Explain in one short sentence for a newcomer: "
    ],
    [
     "in",
     "topic"
    ],
    [
     "cat"
    ],
    [
     "ask",
     "sim"
    ],
    [
     "out"
    ]
   ]
  }
 },
 "project": {
  "supers": [
   {
    "id": "prompt",
    "label": "Prompt",
    "kind": "in",
    "x": 20,
    "y": 120,
    "w": 150,
    "h": 64,
    "input": true
   },
   {
    "id": "superai",
    "label": "Super AI",
    "kind": "ai",
    "x": 210,
    "y": 128,
    "w": 96,
    "h": 48,
    "probe": [
     "/api/super/engines",
     "{ready} engines"
    ]
   },
   {
    "id": "sim",
    "label": "siM",
    "kind": "lab",
    "engine": "sim",
    "x": 350,
    "y": 20,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/scilem/status",
     "{badge}"
    ],
    "opens": "Capabilities"
   },
   {
    "id": "rib",
    "label": "riB",
    "kind": "lab",
    "engine": "rib",
    "x": 350,
    "y": 76,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/engines/status",
     "{riB.weights#} weights"
    ],
    "opens": "Capabilities"
   },
   {
    "id": "pid",
    "label": "piD",
    "kind": "lab",
    "engine": "pid",
    "x": 350,
    "y": 132,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/forecast",
     "{blocks_recorded} blocks"
    ],
    "opens": "Performance"
   },
   {
    "id": "pien",
    "label": "PiEn",
    "kind": "lab",
    "engine": "pien",
    "x": 350,
    "y": 188,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/pien/model",
     "{interactions} uses"
    ],
    "opens": "Capabilities"
   },
   {
    "id": "llama",
    "label": "Llama",
    "kind": "out",
    "engine": "llama",
    "x": 470,
    "y": 8,
    "w": 74,
    "h": 40
   },
   {
    "id": "mistral",
    "label": "Mistral",
    "kind": "out",
    "engine": "mistral",
    "x": 470,
    "y": 58,
    "w": 74,
    "h": 40
   },
   {
    "id": "qwen",
    "label": "Qwen",
    "kind": "out",
    "engine": "qwen",
    "x": 470,
    "y": 108,
    "w": 74,
    "h": 40
   },
   {
    "id": "gemini",
    "label": "Gemini",
    "kind": "out",
    "engine": "gemini",
    "x": 470,
    "y": 158,
    "w": 74,
    "h": 40
   },
   {
    "id": "deepseek",
    "label": "DeepSeek",
    "kind": "out",
    "engine": "deepseek",
    "x": 470,
    "y": 208,
    "w": 74,
    "h": 40
   },
   {
    "id": "judge",
    "label": "Judge",
    "kind": "judge",
    "x": 600,
    "y": 108,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/super/engines",
     "{judge?ready:no key}"
    ]
   },
   {
    "id": "answer",
    "label": "Answer",
    "kind": "sink",
    "x": 720,
    "y": 70,
    "w": 160,
    "h": 118
   },
   {
    "id": "live",
    "label": "Live",
    "kind": "site",
    "x": 906,
    "y": 20,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/live",
     "{today} today"
    ],
    "opens": "@live"
   },
   {
    "id": "traffic",
    "label": "Traffic",
    "kind": "site",
    "x": 906,
    "y": 200,
    "w": 74,
    "h": 40,
    "probe": [
     "/api/traffic",
     "{today} visits"
    ],
    "opens": "Analytics"
   },
   {
    "id": "manuscript",
    "label": "Manuscript",
    "kind": "in",
    "x": 20,
    "y": 330,
    "w": 92,
    "h": 46,
    "probe": [
     "/api/stats/count",
     "{total_analyzed} assessed"
    ],
    "opens": "Assess Manuscripts [Pi]"
   },
   {
    "id": "extract",
    "label": "Extract",
    "kind": "step",
    "x": 132,
    "y": 333,
    "w": 88,
    "h": 40,
    "note": "PDF → text"
   },
   {
    "id": "integrity",
    "label": "Integrity",
    "kind": "step",
    "x": 238,
    "y": 333,
    "w": 88,
    "h": 40,
    "note": "MDAR · RRID"
   },
   {
    "id": "jurors",
    "label": "Jurors",
    "kind": "step",
    "x": 344,
    "y": 333,
    "w": 88,
    "h": 40,
    "probe": [
     "/api/super/engines",
     "{outside} models"
    ]
   },
   {
    "id": "verdict",
    "label": "Verdict",
    "kind": "judge",
    "x": 450,
    "y": 333,
    "w": 88,
    "h": 40,
    "note": "the judge"
   },
   {
    "id": "pix",
    "label": "piX",
    "kind": "step",
    "x": 556,
    "y": 333,
    "w": 88,
    "h": 40,
    "probe": [
     "/api/analytics/summary",
     "avg {avg_score|0}"
    ],
    "opens": "Whitepaper"
   },
   {
    "id": "piq",
    "label": "piQ",
    "kind": "step",
    "x": 662,
    "y": 333,
    "w": 88,
    "h": 40,
    "probe": [
     "/api/emission",
     "floor {current_quality_floor|1}"
    ],
    "opens": "Minting Difficulty"
   },
   {
    "id": "ledger",
    "label": "Ledger",
    "kind": "step",
    "x": 768,
    "y": 333,
    "w": 88,
    "h": 40,
    "probe": [
     "/api/chain/status",
     "{chain_name} #{block_number}"
    ],
    "opens": "Proof-of-Research Ledger Explorer"
   },
   {
    "id": "explorer",
    "label": "Explorer",
    "kind": "sink",
    "x": 874,
    "y": 333,
    "w": 106,
    "h": 40,
    "probe": [
     "/api/explorer/latest",
     "{count} records"
    ],
    "opens": "Proof-of-Research Ledger Explorer"
   }
  ],
  "wires": [
   [
    "prompt",
    "superai"
   ],
   [
    "superai",
    "sim"
   ],
   [
    "superai",
    "rib"
   ],
   [
    "superai",
    "pid"
   ],
   [
    "superai",
    "pien"
   ],
   [
    "superai",
    "llama"
   ],
   [
    "superai",
    "mistral"
   ],
   [
    "superai",
    "qwen"
   ],
   [
    "superai",
    "gemini"
   ],
   [
    "superai",
    "deepseek"
   ],
   [
    "llama",
    "judge"
   ],
   [
    "mistral",
    "judge"
   ],
   [
    "qwen",
    "judge"
   ],
   [
    "gemini",
    "judge"
   ],
   [
    "deepseek",
    "judge"
   ],
   [
    "judge",
    "answer"
   ],
   [
    "sim",
    "answer"
   ],
   [
    "manuscript",
    "extract"
   ],
   [
    "extract",
    "integrity"
   ],
   [
    "integrity",
    "jurors"
   ],
   [
    "jurors",
    "verdict"
   ],
   [
    "verdict",
    "pix"
   ],
   [
    "pix",
    "piq"
   ],
   [
    "piq",
    "ledger"
   ],
   [
    "ledger",
    "explorer"
   ],
   [
    "pix",
    "pid"
   ],
   [
    "pix",
    "rib"
   ],
   [
    "b-Tools",
    "manuscript"
   ],
   [
    "explorer",
    "b-Explore"
   ],
   [
    "ledger",
    "live"
   ]
  ],
  "sections": [
   {
    "label": "one prompt, every engine",
    "x": 14,
    "y": 0,
    "w": 972,
    "h": 270
   },
   {
    "label": "the assessment",
    "x": 14,
    "y": 300,
    "w": 972,
    "h": 110
   },
   {
    "label": "the site",
    "x": 14,
    "y": 470,
    "w": 972,
    "h": 100
   }
  ],
  "siteRow": {
   "x": 20,
   "y": 500,
   "w": 960,
   "h": 40,
   "extra": []
  }
 }
};
