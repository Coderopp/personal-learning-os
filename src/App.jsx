import { useMemo, useState } from 'react'

const mission = {
  name: 'Production LLM Engineering',
  capability: 62,
  target: 85,
  description: 'Build, evaluate, optimize and ship reliable LLM systems.'
}

const competencies = [
  ['Foundations', 74, []],
  ['Transformers', 61, ['Foundations']],
  ['Embeddings', 57, ['Foundations']],
  ['Retrieval & RAG', 58, ['Transformers', 'Embeddings']],
  ['LLM Evaluation', 49, ['Retrieval & RAG']],
  ['Inference & Optimization', 43, ['Transformers']],
  ['Agents & Tool Use', 46, ['LLM Evaluation']],
  ['Production Systems', 37, ['LLM Evaluation', 'Inference & Optimization', 'Agents & Tool Use']],
]

const resources = [
  {
    id: 'attention', type: 'paper', title: 'Attention Is All You Need',
    domain: 'Transformers', level: 'Intermediate', time: '60–90 min',
    quality: 5, official: true, url: 'https://arxiv.org/abs/1706.03762',
    reason: 'Primary source for Transformer architecture and scaled dot-product attention.'
  },
  {
    id: 'hf-llm', type: 'course', title: 'Hugging Face LLM Course',
    domain: 'LLMs', level: 'Beginner → Advanced', time: 'Variable',
    quality: 5, official: true, url: 'https://huggingface.co/learn/llm-course/chapter0/1',
    reason: 'Structured path through Transformers, datasets, fine-tuning, deployment and advanced LLM topics.'
  },
  {
    id: 'fsdl', type: 'course', title: 'Full Stack Deep Learning',
    domain: 'Production ML', level: 'Advanced', time: 'Variable',
    quality: 5, official: true, url: 'https://fullstackdeeplearning.com/course/',
    reason: 'Connects modeling with experimentation, deployment and production concerns.'
  },
]

const questions = [
  {
    type: 'derivation', prompt: 'Derive why scaled dot-product attention divides QKᵀ by √dₖ. What instability is the scaling intended to reduce?'
  },
  {
    type: 'diagnosis', prompt: 'A RAG system answers easy questions well but fails on obscure facts buried deep in long documents. What should you inspect before changing the LLM?'
  },
  {
    type: 'design', prompt: 'Design an evaluation set that separates retrieval failures from generation failures in a RAG system.'
  },
  {
    type: 'transfer', prompt: 'Sequence length doubles while model weights stay fixed. Predict major inference memory and latency effects and explain the role of KV caching.'
  },
]

const errors = [
  ['Retrieval evaluation', 'Conceptual', 3, 'Confused retrieval recall@k with classification recall.'],
  ['Transformer scaling', 'Conceptual', 2, 'Could not reconstruct the variance argument behind √dₖ.'],
  ['System design', 'Strategic', 2, 'Started implementation before defining constraints and evaluation criteria.'],
]

const stages = [
  ['Recall', 'Reconstruct what you know before opening a source.'],
  ['Learn', 'Study only the missing concept or mental model.'],
  ['Practice', 'Solve a targeted problem at the current bottleneck.'],
  ['Build', 'Make the concept survive in executable work.'],
  ['Diagnose', 'Classify the failure before searching for a fix.'],
  ['Reflect', 'Capture the updated model and schedule retention.'],
]

function Metric({label, value, note}) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function SectionTitle({title, subtitle}) {
  return <div className="section-title"><h2>{title}</h2><p>{subtitle}</p></div>
}

function App() {
  const [tab, setTab] = useState('Command Center')
  const [step, setStep] = useState(0)
  const [done, setDone] = useState([])
  const [filter, setFilter] = useState('all')

  const bottleneck = useMemo(() => [...competencies].sort((a, b) => a[1] - b[1])[0], [])
  const filtered = useMemo(() => filter === 'all' ? resources : resources.filter(r => r.type === filter), [filter])

  const toggle = name => setDone(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">L</div>
          <div><strong>Learning OS</strong><small>v0.1 · local-first</small></div>
        </div>

        <div className="mission">
          <span className="kicker">ACTIVE MISSION</span>
          <h2>{mission.name}</h2>
          <div className="progress"><span style={{width: `${mission.capability}%`}} /></div>
          <div className="split"><span>{mission.capability}/100</span><span>target {mission.target}</span></div>
        </div>

        <nav>
          {['Command Center','Skill Map','Resources','Session Runner','Error Lab','Analytics'].map(item =>
            <button key={item} className={tab === item ? 'nav active' : 'nav'} onClick={() => setTab(item)}>{item}</button>
          )}
        </nav>

        <div className="side-foot"><span className="dot" /> saved locally</div>
      </aside>

      <main className="main">
        <header className="top">
          <div><span className="kicker">PERSONAL LEARNING OS</span><h1>{tab}</h1></div>
          <button className="primary" onClick={() => setTab('Session Runner')}>Start session →</button>
        </header>

        {tab === 'Command Center' && (
          <div className="page">
            <section className="hero">
              <div>
                <span className="kicker">NEXT BEST ACTION</span>
                <h2>Attack the current bottleneck: {bottleneck[0]}</h2>
                <p>{mission.description} The system prioritizes the weakest demonstrated competency instead of adding more broad content.</p>
                <button className="primary" onClick={() => setTab('Session Runner')}>Run bottleneck session</button>
              </div>
              <div className="ring"><strong>{mission.capability}</strong><span>capability</span></div>
            </section>

            <div className="metrics">
              <Metric label="Focused hours" value="18.4" note="this week" />
              <Metric label="7D recall" value="81%" note="↑ 6 pts" />
              <Metric label="30D recall" value="68%" note="baseline 61%" />
              <Metric label="Gain / hour" value="1.42" note="capability pts" />
            </div>

            <section className="panel">
              <SectionTitle title="Today’s loop" subtitle="Complete the loop, not just the content." />
              <div className="loop">
                {stages.map(([name, desc], i) =>
                  <button key={name} onClick={() => toggle(name)} className={done.includes(name) ? 'loop-card done' : 'loop-card'}>
                    <span>0{i + 1}</span><strong>{name}</strong><small>{desc}</small>{done.includes(name) && <em>done</em>}
                  </button>
                )}
              </div>
            </section>

            <div className="two">
              <section className="panel">
                <SectionTitle title="Retention queue" subtitle="Recall first, then check." />
                {[['KV cache','Today','high'],['Scaled dot-product attention','Tomorrow','high'],['Retrieval metrics','Sep 30','medium'],['RAG evaluation','Oct 3','medium']]
                  .map(([name,date,p]) => <div className="row" key={name}><span>{name}</span><b className={p}>{p}</b><time>{date}</time></div>)}
              </section>
              <section className="panel">
                <SectionTitle title="Recurring errors" subtitle="Repeated mistakes become training data." />
                {errors.map(([name,,n]) => <div className="row compact" key={name}><span>{name}</span><time>{n}×</time></div>)}
              </section>
            </div>
          </div>
        )}

        {tab === 'Skill Map' && (
          <div className="page two">
            <section className="panel">
              <SectionTitle title={mission.name} subtitle={mission.description} />
              <div className="skill-list">
                {competencies.map(([name, score, prereqs]) =>
                  <div className="skill" key={name}><div><strong>{name}</strong><small>{prereqs.length ? `Depends on ${prereqs.join(' · ')}` : 'Root competency'}</small></div><div className="score">{score}</div></div>
                )}
              </div>
            </section>
            <section className="panel">
              <SectionTitle title="Excellence benchmark" subtitle="Mastery must be observable." />
              <div className="benchmark">
                <div><strong>Independent build</strong><p>Ship an end-to-end LLM system on an unfamiliar dataset without tutorial-driven implementation.</p></div>
                <div><strong>Evaluation</strong><p>Separate retrieval, generation and system-level failure modes with held-out tests.</p></div>
                <div><strong>Transfer</strong><p>Solve novel architecture and debugging problems without pattern matching to a training example.</p></div>
              </div>
            </section>
          </div>
        )}

        {tab === 'Resources' && (
          <div className="page">
            <section className="panel">
              <div className="section-head"><SectionTitle title="Resource repository" subtitle="Every resource must have a job." />
                <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All types</option><option value="paper">Papers</option><option value="course">Courses</option></select>
              </div>
              <div className="resources">
                {filtered.map(r =>
                  <article className="resource" key={r.id}>
                    <div className="resource-top"><span className="chip">{r.type}</span><span>{'★'.repeat(r.quality)}</span></div>
                    <h3><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></h3>
                    <p>{r.reason}</p>
                    <div className="resource-meta"><span>{r.domain}</span><span>{r.level}</span><span>{r.time}</span></div>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'Session Runner' && (
          <div className="page">
            <section className="hero session">
              <div><span className="kicker">SESSION {String(step + 1).padStart(2,'0')} / 06</span><h2>{stages[step][0]}</h2><p>{stages[step][1]}</p></div>
              <div className="stepper">{stages.map((s,i) => <button key={s[0]} onClick={() => setStep(i)} className={i <= step ? 'current' : ''}>{i+1}</button>)}</div>
            </section>
            <section className="panel">
              <SectionTitle title={step === 0 ? 'Recall prompt' : 'Coach prompt'} subtitle="Attempt first. The system adapts after your attempt." />
              <div className="prompt">
                <span className="chip">{questions[step % questions.length].type}</span>
                <h3>{questions[step % questions.length].prompt}</h3>
                <textarea placeholder="Write your reasoning here…" />
                <div className="actions"><button className="secondary" onClick={() => setStep(Math.min(step + 1, 5))}>Submit attempt</button><button className="ghost">Show targeted hint</button></div>
                <div className="coach-note">AI evaluator, answer grading and adaptive generation are intentionally separated from the client so provider secrets can remain server-side.</div>
              </div>
            </section>
          </div>
        )}

        {tab === 'Error Lab' && (
          <div className="page"><section className="panel">
            <SectionTitle title="Error laboratory" subtitle="A recurring error should automatically become future training data." />
            {errors.map(([concept,category,occurrences,summary]) =>
              <article className="error-card" key={concept}>
                <div className="error-top"><span className="chip">{category}</span><span>{occurrences} occurrences</span></div>
                <h3>{concept}</h3><p>{summary}</p>
                <div className="next"><strong>System rule:</strong> increase future question density for this error.</div>
              </article>
            )}
          </section></div>
        )}

        {tab === 'Analytics' && (
          <div className="page">
            <div className="metrics">
              <Metric label="Time-to-excellence" value="—" note="baseline pending" />
              <Metric label="Capability" value="62" note="target 85" />
              <Metric label="Transfer" value="54%" note="held-out tasks" />
              <Metric label="Recovery latency" value="1 day" note="last disruption" />
            </div>
            <section className="panel">
              <SectionTitle title="Capability trajectory" subtitle="Measure capability, not activity." />
              <div className="chart">{[42,51,58,61,66,71,74].map((v,i) => <div className="bar-wrap" key={i}><div className="bar" style={{height:`${v*2.2}px`}} /><span>W{i+1}</span></div>)}</div>
              <p className="muted">V1 uses seeded data. Replace it with session history and held-out benchmark results when persistence and evaluation services are connected.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
