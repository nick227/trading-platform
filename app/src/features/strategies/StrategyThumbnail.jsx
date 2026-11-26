/**
 * Abstract, self-contained illustrations of the strategies' general methods.
 * These diagrams do not depict prices, actual orders, or recorded performance.
 */
const styles = {
  tmpl_ai_catalyst_momentum: 'ai',
  tmpl_alpha_research: 'research',
  tmpl_dca_accumulator: 'dca',
  tmpl_loss_guard: 'guard',
  tmpl_momentum_buy: 'buy',
  tmpl_momentum_sell: 'exit',
  tmpl_spy_trend_filter: 'trend',
}
function Artwork({ kind }) {
  const grid = <path d="M0 32H360 M0 64H360 M0 96H360 M60 0V132 M120 0V132 M180 0V132 M240 0V132 M300 0V132" stroke="currentColor" strokeOpacity=".09" fill="none" />
  switch (kind) {
    case 'ai': return <><path d="M96 90L155 44L223 80L276 32 M155 44L180 112L223 80 M223 80L276 32" stroke="currentColor" strokeWidth="2" strokeOpacity=".6" fill="none"/>{[[96,90],[155,44],[223,80],[276,32],[180,112]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===2?12:8} fill="var(--tl-surface)" stroke="currentColor" strokeWidth="2.5"/>)}<circle cx="223" cy="80" r="3" fill="currentColor"/></>
    case 'research': return <><rect x="83" y="42" width="194" height="65" rx="10" fill="var(--tl-surface)" stroke="currentColor" strokeOpacity=".35" strokeWidth="2"/><path d="M105 87L130 71L156 79L185 54L211 64" stroke="currentColor" strokeWidth="3" fill="none"/><circle cx="228" cy="67" r="18" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M241 80L261 102" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></>
    case 'dca': return <>{[0,1,2,3,4].map(i=><g key={i}><rect x={85+i*42} y={74-i*9} width="25" height={36+i*9} rx="3" fill="currentColor" fillOpacity={.25+i*.1}/><path d={`M97 ${60-i*9}V${69-i*9}`} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></g>)}<path d="M77 113H295" stroke="currentColor" strokeWidth="2" strokeOpacity=".5"/></>
    case 'guard': return <><path d="M180 23L243 46V75C243 101 214 117 180 123C146 117 117 101 117 75V46Z" fill="var(--tl-surface)" stroke="currentColor" strokeWidth="2.5"/><path d="M137 73L160 64L182 80L203 53L225 60" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M139 96H220" stroke="currentColor" strokeOpacity=".3" strokeDasharray="5 6"/></>
    case 'buy': return <><path d="M65 104L108 89L147 95L188 63L231 70L292 29" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M66 68H295" stroke="currentColor" strokeDasharray="5 7" strokeWidth="1.5" strokeOpacity=".45"/><circle cx="188" cy="63" r="6" fill="var(--tl-surface)" stroke="currentColor" strokeWidth="3"/></>
    case 'exit': return <><path d="M65 103L105 78L142 55L180 38L214 56L248 76L289 107" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M65 87H297" stroke="currentColor" strokeDasharray="6 7" strokeWidth="1.5" strokeOpacity=".45"/><circle cx="248" cy="76" r="6" fill="var(--tl-surface)" stroke="currentColor" strokeWidth="3"/></>
    case 'trend': return <><path d="M65 98Q110 103 149 82T228 63T295 42" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/><path d="M65 84Q135 90 181 80T295 77" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="7 6" strokeOpacity=".45"/><circle cx="228" cy="63" r="6" fill="var(--tl-surface)" stroke="currentColor" strokeWidth="3"/></>
    default: return <><path d="M65 100L111 79L162 88L213 51L295 65" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><path d="M65 110H295" stroke="currentColor" strokeOpacity=".4"/></>
  }
}
export default function StrategyThumbnail({ templateId }) {
  const kind = styles[templateId] || 'default'
  return (
    <div className={`tl-strategy-thumbnail tl-strategy-thumbnail--${kind}`} aria-hidden="true" data-testid="strategy-thumbnail">
      <svg viewBox="0 0 360 132" preserveAspectRatio="xMidYMid meet" focusable="false">
        <path d="M0 32H360 M0 64H360 M0 96H360 M60 0V132 M120 0V132 M180 0V132 M240 0V132 M300 0V132" stroke="currentColor" strokeOpacity=".085" fill="none"/>
        <Artwork kind={kind} />
      </svg>
    </div>
  )
}
