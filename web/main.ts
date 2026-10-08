import './style.css';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, ColorType, PriceScaleMode,
  type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { aggregateCandles } from '../server/detector.ts';
import type { Overview, Detail, Pool, CandidateRow, ActivityPage, FeedbackSummary, UpdatesPage, RangeAlert, UpdateThread } from '../shared/types.ts';
import { alertCoinLabel } from '../shared/alerts.ts';
import { RANGE_INFO, freshReportedCap, belowCapTone } from '../shared/ranges.ts';
import { ACTIVE_VENUES, inScope, isDlmm } from '../shared/scope.ts';
import { knownLowLiquidity } from '../shared/liquidity.ts';
import { marketCapFactor, scaleChart } from '../shared/chart.ts';
import { FEEDBACK, feedbackLabels, feedbackHelp, type FeedbackField } from '../shared/feedback.ts';
import { currentBase } from '../shared/base.ts';
import { checksLabel, tradingProgressLabel } from '../shared/checks.ts';
import { RESEARCH_TAGS, shortlisted, inResearchWatchlist, eligibleCandidate, type ResearchTag, type WatchlistFilter } from '../shared/research.ts';
import { SHORTLIST_STAGES, shortlistStage, automaticShortlistStage, manualStageBlock, type ShortlistStage } from '../shared/shortlist.ts';
import { extremeDrawdown } from '../shared/drawdown.ts';
import { CANDLE_PROFILES } from '../shared/candle-policy.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
const icons: Record<string,string> = {
  radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  wave: '<path d="M2 13h4l3-8 5 15 3-7h5"/>',
  down: '<path d="m5 7 14 10m0-8v8h-8"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  pin: '<path d="m8 3 8 0-1 7 3 4H6l3-4-1-7Zm4 11v7"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8m-10 4h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-9H4v15h15v-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.radar}</svg>`;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const money = (n: number | null, compact = true) => n === null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2 }).format(n);
const price = (n: number | null) => n === null ? '—' : '$' + (n < .01 ? n.toPrecision(4) : n.toLocaleString('en-US',{ maximumFractionDigits: 4 }));
const count = (n: number) => n.toLocaleString('en-US');
const ago = (time: number | null) => {
  if (!time) return 'Not yet'; const s = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s/60)}m ago` : s < 86400 ? `${Math.floor(s/3600)}h ago` : `${Math.floor(s/86400)}d ago`;
};
const date = (time: number) => new Date(time).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
const short = (s: string) => `${s.slice(0,5)}…${s.slice(-4)}`;
const tokenSupply=(raw:string|null|undefined,decimals:number|null|undefined)=>{
  if(!raw||decimals===null||decimals===undefined)return 'Unverified';
  const units=raw.padStart(decimals+1,'0'), whole=decimals?units.slice(0,-decimals):units, fraction=decimals?units.slice(-decimals).replace(/0+$/,''):'';
  return BigInt(whole).toLocaleString('en-US')+(fraction?'.'+fraction:'')+' tokens';
};
let data: Overview | null = null, detail: Detail | null = null;
let view = 'shortlist', group: WatchlistFilter = 'all', query = '', venue = 'All venues', pinned = false;
let researchTagFilter: ResearchTag | '' = '';
let capFilter='all';
let shortlistSelection: ShortlistStage = 'ready';
const reviewViews=['shortlist','following','archive','watchlist','pools','history','ignored'];
const draftCache=new Map<string,Record<string,unknown>>();
const disclosureState=new Map<string,boolean>();
let selected: string | null = null, timeframe = 15, logScale = false, chart: IChartApi | null = null;
let chartValue: 'price' | 'marketCap' = 'price';
let selectedExact=false;
let loadingDetail = false, fetchNumber = 0, serverError = '', chartRange: any = null;
let activity: ActivityPage | null = null, feedback: FeedbackSummary | null = null;
let alerts: UpdatesPage | null = null, alertsBefore: number | null = null;
let alertsFilter: 'all' | 'unread' = 'all';
let activityCategory = '', activityEntity = '', activityBefore: number | null = null;
const formationLabels=feedbackLabels('formation'), baseLabels=feedbackLabels('base'), scopeLabels=feedbackLabels('scope'), reasonLabels=feedbackLabels('reason');

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...options?.headers } });
  const result = await res.json(); if (!res.ok) throw new Error(result.error || `Request failed (${res.status})`); return result;
}
function toast(message: string, error = false) {
  document.querySelector('.toast')?.remove(); const el = document.createElement('div');
  el.className = `toast ${error ? 'error' : ''}`; el.setAttribute('role','status'); el.textContent = message;
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}
function seeChart(mint: string, label = '') {
  return `<a class="text-btn external-chart" href="https://jup.ag/tokens/${encodeURIComponent(mint)}" target="_blank" rel="noopener noreferrer" title="${esc(label?`See ${label} on Jupiter`:'See token chart on Jupiter')}">jup</a>`;
}
function avatar(p: Pool) { return `<span class="avatar ${p.venue.toLowerCase()}">${esc((p.symbol || p.mint).slice(0,2).toUpperCase())}</span>`; }
function badge(p: Pool) { return `<span class="venue-dot ${p.venue.toLowerCase()}"></span>${esc(p.venue)}`; }
function freshness(p: Pool) { return p.metricsAt && Date.now() - p.metricsAt < 120_000 ? 'fresh' : 'stale'; }
const matches = (p: Pool) => (venue === 'All venues' || p.venue === venue) && `${data?.chartCodes[p.address]??''} ${p.symbol} ${p.name} ${p.mint} ${p.address}`.toLowerCase().includes(query.toLowerCase());
const active = eligibleCandidate;
const belowLegend = () => `<div class="cap-legend" aria-label="Below $30k colour bands"><span class="cap-yellow">$20k–below $30k</span><span class="cap-orange">$10k–below $20k</span><span class="cap-red">Below $10k</span></div>`;
function researchBadges(c: CandidateRow) {
  return `<div class="research-badges">${c.manualWatch?'<span class="research-badge selected-by-you">My selection</span>':''}${(c.researchTags??[]).map(tag=>`<span class="research-badge">${esc(RESEARCH_TAGS[tag]?.label??tag)}</span>`).join('')}</div>`;
}
function rangeBadge(c: CandidateRow) {
  const range=RANGE_INFO[c.capRange], current=freshReportedCap(c.poolData,Date.now())&&c.lastCapAt===c.poolData.metricsAt;
  return `<span class="range-badge ${c.capRange} ${c.capRange==='below'?belowCapTone(c.lastMarketCap):''}" title="${esc(range.label)}${current?'':' · last verified observation'}">${range.code} · ${esc(range.label)}</span>${current?'':`<small>Last verified ${ago(c.lastCapAt)}</small>`}`;
}

function captureDrafts() {
  document.querySelectorAll<HTMLFormElement>('form[data-draft-key]').forEach(form=>{
    if(form.dataset.dirty!=='true')return;
    const key=form.dataset.draftKey!, values:Record<string,unknown>={};
    for(const el of form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input[name],select[name],textarea[name]')) {
      if(el instanceof HTMLInputElement&&el.type==='checkbox')values[el.name]=Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${el.name}"]:checked`)).map(x=>x.value);
      else values[el.name]=el.value;
    }
    draftCache.set(key,values);try{sessionStorage.setItem(`review-draft:${key}`,JSON.stringify(values));}catch{}
  });
}
function restoreDrafts() {
  document.querySelectorAll<HTMLFormElement>('form[data-draft-key]').forEach(form=>{
    const key=form.dataset.draftKey!;let values=draftCache.get(key);
    if(!values)try{values=JSON.parse(sessionStorage.getItem(`review-draft:${key}`)||'null')??undefined;}catch{}
    if(!values)return;
    for(const el of form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input[name],select[name],textarea[name]')) {
      if(el instanceof HTMLInputElement&&el.type==='checkbox')el.checked=(values[el.name] as string[]??[]).includes(el.value);
      else if(typeof values[el.name]==='string')el.value=values[el.name] as string;
    }
    form.dataset.dirty='true';
  });
}
function render() {
  captureDrafts();
  if (chart) { chartRange = chart.timeScale().getVisibleLogicalRange(); chart.remove(); chart = null; }
  if (!data) { app.innerHTML = `<div class="boot">${icon('radar')}<h1>Observatory</h1><p>${serverError ? esc(serverError) : 'Connecting to your live scanner…'}</p><button class="btn" id="retry">Reconnect</button></div>`; document.querySelector('#retry')?.addEventListener('click', () => load()); return; }
  const errors = data.health.filter(h => h.state === 'error').length;
  app.innerHTML = `<div class="layout">
    <aside class="sidebar">
      <a class="brand" href="#">${icon('radar')}<span>observatory<span class="brand-sub">SOLANA / LAUNCH SCANNER</span></span></a>
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        ${nav('shortlist','grid','Shortlist',data.candidates.filter(c=>shortlistStage(c)==='ready').length)}
        ${nav('following','pin','Following',data.candidates.filter(c=>inResearchWatchlist(c)&&(c.manualWatch||c.shortlistedAt)).length)}
        ${nav('alerts','bell','Updates',data.unreadAlerts||'')}
        ${nav('archive','archive','Archive','')}
      </nav>
      <details class="research-navigation" data-disclosure="navigation" ${['pools','watchlist','history','ignored','feedback','activity','health','settings'].includes(view)?'open':''}>
        <summary>Research & settings</summary>
        <nav aria-label="Supporting research">
          ${nav('watchlist','radar','Background observations','')}
          ${nav('pools','layers','Pool explorer','')}
          ${nav('history','layers','Linked Meteora pools','')}
          ${nav('ignored','close','Low liquidity history','')}
          ${nav('feedback','check','Review history','')}
          ${nav('activity','layers','Activity log','')}
          ${nav('health','wave','Sources & coverage',errors?'!':'')}
          ${nav('settings','settings','Settings','')}
        </nav>
      </details>
      <div class="sidebar-bottom"><p class="quiet-caption">A workspace for deliberate research.</p><button class="nav-item" data-view="health"><span class="status-dot ${data.running?'':'paused'}"></span><span>${data.running?'Scanner running':'Scanner paused'}</span></button></div>
    </aside>
    <main><header class="topbar"><div class="breadcrumbs">${view==='shortlist'?'Shortlist':view==='following'?'Following':view==='archive'?'Archive':view==='alerts'?'Updates':'Research'}</div>
      <div class="top-status"><span title="Last response from the app. Market data, candles and checks have separate timestamps.">App synced ${ago(data.asOf)}</span><button class="notification-bell ${view==='alerts'?'selected':''}" data-view="alerts" aria-label="Open updates, ${data.unreadAlerts} unread">${icon('bell')}${data.unreadAlerts?`<b>${data.unreadAlerts}</b>`:''}</button></div></header>
      <div class="page">
        ${serverError ? `<div class="notice error">${esc(serverError)} · showing last received data</div>` : ''}
        ${view === 'health' ? healthPage() : view === 'settings' ? settingsPage() : view==='activity'?activityPage():view==='feedback'?feedbackPage():view==='alerts'?alertsPage():researchPage()}
      </div>
    </main>
  </div>`;
  restoreDrafts();bind(); if (detail && reviewViews.includes(view)) drawChart();
}
function nav(id: string, name: string, label: string, n: string | number) {
  return `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}" aria-label="${label}">${icon(name)}<span>${label}</span>${n !== '' ? `<b>${esc(n)}</b>` : ''}</button>`;
}
function researchPage() {
  const historical=view==='history', ignored=view==='ignored', registry=['pools','history','ignored'].includes(view);
  const background=view==='watchlist';
  const now=Date.now(), stages=new Map(data!.candidates.map(c=>[c.mint,shortlistStage(c,now)]));
  const stage=SHORTLIST_STAGES[shortlistSelection];
  let candidates=data!.candidates.filter(c=>view==='shortlist'?stages.get(c.mint)===shortlistSelection:view==='following'?inResearchWatchlist(c)&&(c.manualWatch||c.shortlistedAt):view==='archive'?c.archived:!c.archived&&inScope(c.poolData));
  candidates=candidates.filter(c=>(capFilter==='all'||c.capRange===capFilter)&&(!background||group==='all'||c.group===group)&&(!researchTagFilter||c.researchTags?.includes(researchTagFilter))&&(!pinned||c.pinned)&&matches(c.poolData))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(b.capRange==='within')-Number(a.capRange==='within')||(b.base?.score??0)-(a.base?.score??0));
  const pools=data!.pools.filter(p=>historical?!inScope(p):inScope(p)&&(ignored?knownLowLiquidity(p):!knownLowLiquidity(p)))
    .filter(p=>historical||ignored||!data!.poolContexts[p.mint]?.preferredPool||data!.poolContexts[p.mint].preferredPool===p.address).filter(matches);
  const title=view==='shortlist'?'Shortlist':view==='following'?'Following':view==='archive'?'Archive':background?'Background observations':historical?'Linked Meteora pools':ignored?'Low liquidity history':'Pool explorer';
  const description=view==='shortlist'?'Follow a setup from its first pullback to an established base. Choose how early you want to look.':view==='following'?'The charts you chose, and setups previously shortlisted. Your assessment stays attached as they develop.':view==='archive'?'Set aside, with the history intact. Restore a chart whenever you want to reconsider it.':background?'Early observations and incomplete setups stay here, quietly. Appearing here is not qualification for the final shortlist.':historical?'Secondary pools linked by the exact token address. Their context stays separate from the chart.':ignored?'Pools below the liquidity floor. Earlier evidence and reviews are retained.':'Explore the available real pool records and their screening evidence.';
  if(detail||loadingDetail)return `<div class="review-toolbar"><button class="text-btn" id="back-to-list">← Back to ${view==='shortlist'?stage.label:view==='following'?'following':'results'}</button><span class="small muted">${detail?esc(detail.chartCode):''}</span></div><div class="coin-workspace">${detailPanel()}</div>`;
  return `<div class="page-heading"><div><div class="eyebrow">${view==='shortlist'?'CONSOLIDATION RESEARCH':'YOUR WORKSPACE'}</div><h1>${title}</h1><p>${description}</p></div>${view!=='shortlist'&&view!=='archive'?`<button class="btn subtle" id="add-pool">${icon('plus')} Find a token</button>`:''}</div>
    ${view==='shortlist'?`<div class="shortlist-stages" role="group" aria-label="Shortlist stages">${Object.entries(SHORTLIST_STAGES).map(([id,s])=>`<button class="shortlist-stage ${shortlistSelection===id?'selected':''}" data-shortlist-stage="${id}" aria-pressed="${shortlistSelection===id}" aria-label="Stage ${s.number}: ${s.label}"><span class="stage-step">Stage ${s.number}</span><span class="stage-title">${s.label}<b>${[...stages.values()].filter(v=>v===id).length}</b></span><span class="stage-caption">${s.summary}</span></button>`).join('')}</div><div class="shortlist-explanation"><p>${stage.description}</p><span>Earlier stages stay quiet. New setup alerts begin at Ready to review.</span></div>`:''}
    <section class="results-panel">
      <div class="results-heading"><h2>${view==='shortlist'?`${stage.label} · ${candidates.length}`:`${registry?pools.length:candidates.length} ${registry?'pools':'charts'}`}</h2><span class="small muted">${view==='shortlist'?'Ranked by observed structure':'Live observations · saved history'}</span></div>
      <div class="filters"><label class="search">${icon('search')}<input id="search" placeholder="Search by name or token address" aria-label="Search tokens" value="${esc(query)}"/></label><select id="venue" aria-label="Filter venue">${['All venues',...(historical?['Meteora']:ACTIVE_VENUES)].map(v=>`<option ${v===venue?'selected':''}>${v}</option>`).join('')}</select></div>
      ${!registry?`<div class="filter-row"><label>Market cap<select id="cap-filter">${[['all','All ranges'],['within','$30k–$250k'],['above','Above $250k'],['below','Below $30k']].map(([id,label])=>`<option value="${id}" ${capFilter===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Your tag<select id="research-tag-filter"><option value="">All tags</option>${Object.entries(RESEARCH_TAGS).map(([id,tag])=>`<option value="${id}" ${researchTagFilter===id?'selected':''}>${esc(tag.label)}</option>`).join('')}</select></label>${background?`<label>Checks<select id="check-filter">${[['all','All observations'],['pending','Pending'],['excluded','Failed']].map(([id,label])=>`<option value="${id}" ${group===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<button class="icon-btn ${pinned?'is-pinned':''}" id="filter-pinned" aria-label="Show pinned only" aria-pressed="${pinned}">${icon('pin')}</button></div>`:''}
      ${capFilter==='below'?belowLegend():''}${registry?poolTable(pools):candidateTable(candidates)}
    </section><div class="page-foot"><span>Only observed data. Coverage and checks can be incomplete.</span><button class="text-btn" data-view="health">Source status</button></div>`;
}
function candidateTable(rows: CandidateRow[]) {
  if(!rows.length)return `<div class="empty calm-empty"><h3>${query||capFilter!=='all'||researchTagFilter||venue!=='All venues'||pinned?'No charts match these filters':view==='shortlist'?SHORTLIST_STAGES[shortlistSelection].empty:view==='following'?'Your followed charts will appear here':view==='archive'?'Nothing archived':'No observations in this view'}</h3><p>${view==='shortlist'?SHORTLIST_STAGES[shortlistSelection].emptyHelp:view==='following'?'Follow a chart during review to keep it here across range changes.':'Your saved research remains available in the other views.'}</p>${view==='shortlist'?'<button class="text-btn" data-view="following">View followed charts</button>':''}</div>`;
  return `<div class="setup-list">${rows.map(c=>{const p=c.poolData,b=c.base,ready=currentBase(b),stage=automaticShortlistStage(c);
    const early=stage==='early',forming=stage==='forming';
    const summary=early?'Rise + pullback detected':ready||forming?`${b!.durationHours}h ${b!.shape==='rising'?'rising ':''}${ready?'base':'developing range'} · ${b!.widthPercent!.toFixed(1)}% band`:'Still under observation';
    const explanation=early?`${c.episode.signal.rise.toFixed(1)}× earlier rise · ${(c.episode.signal.pullback*100).toFixed(0)}% pullback · base unconfirmed`:forming?(ready?'Base formed · waiting for checks':'Needs more distinct range tests'):ready?`Tightness ${b!.tightnessTier}/5 · ${b!.compression==='unknown'?'compression unverified':b!.compression} · ${b!.floorTests} floor tests`:b?.reasons[0]??'Waiting for a consolidation assessment';
    return `<article class="setup-row">
    <button class="setup-open" data-pool="${esc(p.address)}" aria-label="Review ${esc(p.symbol||short(p.mint))}"><span class="token-cell">${avatar(p)}<span><strong>${esc(p.symbol||short(p.mint))}</strong><small>${esc(p.name||p.venue)} · ${esc(p.venue)}</small></span></span><span class="setup-summary">${esc(summary)}<small>${esc(explanation)}</small></span><span class="setup-cap ${belowCapTone(p.marketCap)}"><strong>${money(p.marketCap)}</strong><small>Market cap</small></span><span class="setup-liquidity"><strong>${money(p.liquidity)}</strong><small>Pool liquidity</small></span></button>
    <div class="setup-meta">${c.manualStage?`<span class="manual-tier-badge">Your placement · Tier ${SHORTLIST_STAGES[c.manualStage.stage].number}</span>`:''}<span class="stage ${c.risk.status==='passed'?'':'provisional'}" title="${esc(checksLabel(c).startsWith('Trading')?c.tradingProgress?.reason??c.risk.reasons[0]:c.risk.reasons[0])}">${esc(checksLabel(c))}</span>${researchBadges(c)}${extremeDrawdown(c.drawdown)?`<span class="drawdown-label">${c.drawdown!.percent.toFixed(1)}% below recorded peak</span>`:''}<span class="small muted">Market data ${ago(p.metricsAt)}</span><button class="text-btn" data-tier-pool="${esc(p.address)}">Move tier</button>${seeChart(p.mint,p.symbol)}</div>
  </article>`;}).join('')}</div>`;
}
function poolTable(rows: Pool[]) {
  if (!rows.length) return `<div class="empty"><div class="empty-orbit">${icon('layers')}</div><h3>${data!.totalPools?'No pools match these filters':'Connecting to pool sources'}</h3><p>New pool records will appear as the live feeds respond. Open Sources & coverage to see connection status.</p><button class="btn subtle" data-view="health">View sources ${icon('arrow')}</button></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>Token / venue</th><th>Volume</th><th>Liquidity</th><th>Detector</th><th>Market data</th></tr></thead><tbody>${rows.slice(0,100).map(p=>`<tr class="select-row ${selected===p.address?'selected-row':''}" data-pool="${esc(p.address)}" tabindex="0" role="button" aria-label="Inspect ${esc(p.symbol||short(p.mint))}">
    <td><div class="token-cell">${avatar(p)}<div><strong>${esc(p.symbol||short(p.mint))}</strong><small>${badge(p)} · ${esc(data!.chartCodes[p.address])}</small>${seeChart(p.mint,p.symbol)}</div></div></td>
    <td><span class="numeric">${money(p.volume5m??p.volume30m??p.volume1h)}</span><small>${p.volume5m!==null?'5m':p.volume30m!==null?'30m':p.volume1h!==null?'1h':'Window unavailable'} reported</small></td>
    <td><span class="numeric">${money(p.liquidity)}</span><small>${ago(p.createdAt)} created</small></td>
    <td><span class="scan-result">${esc(data!.controls[p.mint]?.status==='excluded'?'Controls excluded':p.screen)}</span><small>${esc(data!.controls[p.mint]?.status==='excluded'?data!.controls[p.mint].reasons[0]:p.candleAt?`${ago(p.candleAt)} checked`:'Waiting for candles')}</small></td>
    <td><span class="freshness ${freshness(p)}">${ago(p.metricsAt)}</span><small>${p.issue?'Source gap':p.origin==='Unknown'?'Origin unverified':esc(p.origin)}</small></td>
    </tr>`).join('')}</tbody></table>${rows.length>100?`<div class="table-limit">Showing 100 of ${count(rows.length)} loaded pools. Search to narrow the list; all discovered records stay stored.</div>`:''}</div>`;
}
function detailPanel() {
  if (loadingDetail && !detail) return `<section class="detail-panel empty"><div class="loading-spinner"></div><p>Loading pool evidence…</p></section>`;
  if (!detail) return `<section class="detail-placeholder"><div class="chart-ghost"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><h3>A closer look starts here</h3><p>Select a candidate or scanned pool to inspect its candles, volume and detection evidence.</p><span class="small muted">Your review stays attached to the coin.</span></section>`;
  const p=detail.pool, c=detail.row, poolEpisode=detail.episodes.filter(e=>e.pool===p.address).at(-1), s=poolEpisode?.signal;
  const bars=timeframe===1?detail.candles1m:detail.candles, source=timeframe===1?detail.minuteSource:detail.candleSource;
  const chartAt=timeframe===1?detail.minuteChart.checkedAt:p.candleAt, issue=timeframe===1?detail.minuteChart.issue:p.issue;
  const factor=marketCapFactor(p), capView=chartValue==='marketCap', paused=!inScope(p)||knownLowLiquidity(p);
  return `<section class="detail-panel">
    <div class="detail-heading"><div class="token-cell">${avatar(p)}<div><h2>${esc(p.symbol||short(p.mint))} <span class="muted">/ USD</span></h2><small>${badge(p)} <span class="muted">· ${esc(p.route)}</span></small></div></div><button class="icon-btn" id="close-detail" aria-label="Close details">${icon('close')}</button></div>
    <div class="detail-sub"><button class="text-btn mono" id="copy-mint" title="Copy token address">${short(p.mint)} ${icon('copy')}</button>${seeChart(p.mint,p.symbol)}<a class="text-btn" href="https://dexscreener.com/solana/${esc(p.address)}" target="_blank" rel="noopener noreferrer">DexScreener ${icon('external')}</a></div>
    <div class="price-row"><div><strong>${price(p.price)}</strong><span>Price per token · USD</span></div><div class="pool-liquidity"><strong>${money(p.liquidity)}</strong><span>Pool liquidity · USD</span><small>${ago(p.metricsAt)} · ${esc(p.metricsSource)}</small></div><div class="align-right"><b class="${belowCapTone(p.marketCap)}">${money(p.marketCap)}</b><span>${p.marketCap!==null?'Market cap · reported':p.fdv!==null?`${money(p.fdv)} FDV · cap unknown`:'Market cap unavailable'}</span></div></div>
    ${researchTrackingPanel()}
    ${tierPlacementNote()}
    ${c&&extremeDrawdown(c.drawdown)?`<div class="decision-note"><strong>Extreme retracement</strong><span>Recorded ${c.drawdown!.worstPercent.toFixed(1)}% decline; now ${c.drawdown!.percent.toFixed(1)}% below the peak. Held out of automatic tiers until price recovers above 10% of the peak. You can still place it manually.</span></div>`:''}
    ${c?.archived?'<div class="decision-note">Archived. Restore to reconsider this chart; earlier reviews stay saved.</div>':''}
    ${detail.risk.status!=='passed'&&!(c&&active(c)&&detail.risk.manualReview?.approved)?`<div class="decision-note ${detail.risk.status==='excluded'?'error':''}"><strong>${esc(c?checksLabel(c):detail.risk.status==='excluded'?'Checks failed':'Checks pending')}</strong><span>${esc(c&&checksLabel(c).startsWith('Trading')&&detail.tradingProgress?detail.tradingProgress.reason:detail.risk.reasons[0]??'Verification is incomplete.')}</span><button class="text-btn" id="show-checks">View checks</button></div>`:''}
    <div class="chart-toolbelt"><div class="chart-controls"><div aria-label="Chart interval">${[1,5,15,60,240].map(t=>`<button aria-pressed="${timeframe===t}" class="${timeframe===t?'active':''}" data-timeframe="${t}">${t<60?`${t}m`:`${t/60}h`}</button>`).join('')}</div><div><button id="log-scale" class="${logScale?'active':''}">Log</button><button class="icon-btn" id="refresh-pool" ${paused?'disabled':''} title="Queue fresh candles and metrics" aria-label="Refresh pool">${icon('refresh')}</button></div></div>
    <div class="chart-value-controls" role="group" aria-label="Chart pricing"><button class="${!capView?'active':''}" aria-pressed="${!capView}" data-chart-value="price">Token price</button><button class="${capView?'active':''}" aria-pressed="${capView}" data-chart-value="marketCap">Market cap</button><span>${capView?'Estimated market cap · USD':'USD per token'}</span></div></div>
    ${capView?'<p class="chart-basis small muted">Estimated historical market cap · uses current implied supply. Volume is USD.</p>':''}
    <div id="chart-legend" class="chart-legend">${bars.length?`${capView?'Estimated market cap':'Token price'} · ${timeframe===1?'1m':'5m'} source candles`:'Waiting for candle history'}</div>
    <div id="chart">${capView&&factor===null?'<div class="chart-empty"><p>Market cap unavailable</p><small>Switch to Token price to inspect the recorded candles.</small></div>':!bars.length?`<div class="chart-empty">${icon('wave')}<p>No usable ${timeframe===1?'1m ':''}candles yet</p><small>${esc(paused?'Collection paused; retained history only.':issue||(!data!.running?'Scanner paused. Resume collection in Sources & coverage.':'Waiting for the live candle feed.'))}</small>${paused?'':'<button class="btn subtle" id="request-candles">Queue chart check</button>'}</div>`:''}</div>
    <div class="chart-attribution"><span>${ago(chartAt)} · chart retrieved · Volume USD</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charts by TradingView</a></div>
    ${timeframe===1&&issue?`<div class="inline-warning">1m chart: ${esc(issue)}</div>`:''}
    ${p.issue?`<div class="inline-warning">${esc(p.issue)}</div>`:''}
    <div class="base-summary"><div class="section-heading"><h3>${currentBase(detail.base)?detail.base?.shape==='rising'?'Rising consolidation observed':'Sideways consolidation observed':detail.base?.status==='qualified'?'Consolidation · fresh candles needed':'Consolidation not established'}</h3>${detail.base?.durationHours?`<span class="tag">${detail.base.durationHours}h window</span>`:''}</div>
      <p>${esc(detail.base?.reasons[0]??'The scanner is assessing the available history.')}</p>
      ${detail.base?.widthPercent!==null&&detail.base?.widthPercent!==undefined?`<div class="base-facts"><span><b>${detail.base.widthPercent.toFixed(1)}%</b> ${detail.base.shape==='rising'?'band around slope':'range width'}</span><span><b>${detail.base.floorTests}</b> floor tests</span><span><b>${detail.base.activePercent?.toFixed(0)}%</b> active candles</span></div>`:''}
      ${detail.base?.status==='qualified'&&detail.base.tightnessTier?`<p class="small">Tightness ${detail.base.tightnessTier}/5 · ${detail.base.compression==='unknown'?'compression unverified':esc(detail.base.compression)}${detail.base.priorityBoost?' · added review priority':''}</p>`:''}
      <small>Observed structure, separate from your assessment. ${detail.base?.launchBasis==='pool_creation'?'Launch proximity uses this pool’s creation time.':''}</small>
    </div>
    <details class="evidence-disclosure" data-disclosure="screening"><summary>Screening details <span>${esc(c?checksLabel(c):detail.risk.status)}</span></summary>${riskPanel()}</details>
    <details class="evidence-disclosure" data-disclosure="pattern"><summary>Pattern evidence & source data</summary>
      <h3>Earlier pump</h3><p>${s?`${s.rise.toFixed(2)}× rise · ${s.volumeRatio?.toFixed(1)??'unconfirmed'}× volume · ${esc(s.stage)}`:esc(p.screen)}</p>
      ${c?.drawdown?`<h3>Retracement from recorded peak</h3><p>${c.drawdown.percent.toFixed(1)}% below ${price(c.drawdown.peakPrice)}. ${esc(c.drawdown.peakSource)}; ${date(c.drawdown.peakAt)}. Current comparison: ${price(c.drawdown.price)} at ${date(c.drawdown.priceAt)}. Deepest recorded decline: ${c.drawdown.worstPercent.toFixed(1)}%, using later closes and price observations. A ${c.drawdown.thresholdPercent}% decline triggers an automatic hold, which clears once the decline is less than ${c.drawdown.recoveryBelowPercent}%. These starting thresholds describe your scope preference, not proof that a coin is dead.</p>`:''}
      <p>${esc(s?.reasons.join(' ')??'No matching pump yet.')}</p>
      <h3>Current base assessment</h3><ul>${(detail.base?.reasons??['Assessment pending']).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>
      <p>Evaluates windows from 1 hour to 2 weeks. Longer persistence adds weight; it does not estimate a probability of a future move.</p>
      <p>Rising bases are measured around their slope and need repeated pullbacks and range tests. A qualified rising base receives extra review priority; tightening adds more. These observations do not establish who holds the token or how long they hold it.</p>
      <p>Tightness 5 means a band up to 5%; 4 up to 10%; 3 up to 15%; 2 up to 25%; 1 wider. The band contains the central 80% of closes. Tightening compares equal halves of the selected window, so compare direction and duration together. These are initial descriptive cutoffs, not probabilities.</p>
      <p>${esc(p.coverage)} ${esc(p.evidence)}</p><p>Market-cap candles use current implied supply across the history. Historical supply changes are not independently verified. Volume remains USD.</p>
      <div class="pool-identity"><b>${esc(p.venue)} · ${esc(p.route)}</b><span class="mono">${esc(p.address)}</span></div>${poolContextPanel()}
      <a class="btn subtle" href="/api/evidence/${esc(p.address)}" download>${icon('download')} Export review evidence</a>
    </details>
    <details class="evidence-disclosure" data-disclosure="reviews"><summary>Your review history <span>${detail.notes.length+detail.feedback.length+(detail.stageReviews?.length??0)}</span></summary>
      ${(detail.stageReviews??[]).map(r=>`<article class="saved-review"><strong>${stageName(r.fromStage)} → ${r.toStage?stageName(r.toStage):'Automatic placement'}</strong><small>${date(r.createdAt)} · Scanner: ${stageName(r.automaticStage)}</small><p>${esc(r.reason||'No reason added.')}</p></article>`).join('')}
      ${detail.feedback.map(f=>`<article class="saved-review"><strong>${esc(formationLabels[f.formation])} · ${esc(baseLabels[f.base])}</strong><small>${date(f.createdAt)}</small><p>${esc(f.notes)}</p></article>`).join('')}
      ${detail.notes.map(n=>`<article class="saved-review"><strong>${esc(n.label||'Review note')}</strong><small>${date(n.createdAt)}</small><p>${esc(n.body)}</p></article>`).join('')||(!detail.feedback.length&&!detail.stageReviews?.length?'<p>No reviews saved yet.</p>':'')}
    </details>
    <details class="evidence-disclosure" data-disclosure="cap-history"><summary>Market-cap range history <span>${c?esc(RANGE_INFO[c.capRange].label):'Observations'}</span></summary>
      ${c?rangeBadge(c):''}
      ${detail.crossings.map(crossing=>`<article class="saved-review ${belowCapTone(crossing.value)}"><strong>${esc(crossing.kind)}</strong><span>${money(crossing.value)}</span><small>${date(crossing.observedAt)} · ${esc(crossing.source)}</small></article>`).join('')||'<p>No range transitions recorded yet.</p>'}
    </details>
    ${feedbackForm()}
    ${tierForm()}
  </section>`;
}
function feedbackForm() {
  const c=detail!.row,blocked=c&&(c.archived||!inScope(c.poolData)||knownLowLiquidity(c.poolData));
  return `<dialog class="feedback-dialog" id="feedback-dialog" aria-labelledby="feedback-title"><div class="section-heading"><h2 id="feedback-title">Your view of ${esc(detail!.pool.symbol)}</h2><button class="icon-btn" id="close-feedback" aria-label="Close feedback">${icon('close')}</button></div><p class="muted">Save your judgment alongside the chart as it looks now.</p>
    <form id="research-tags-form" data-draft-key="${esc(detail!.pool.address)}:review">
      ${c?`<fieldset ${blocked?'disabled':''}><legend>Your tags</legend><div class="research-tag-options">${Object.entries(RESEARCH_TAGS).map(([id,tag])=>`<label title="${esc(tag.help)}"><input type="checkbox" name="tags" value="${id}" ${c.researchTags?.includes(id as ResearchTag)?'checked':''}/><span>${esc(tag.label)}</span></label>`).join('')}</div><small>Not my setup archives this coin. Other tags keep it in Following.</small></fieldset>`:''}
      <label>Notes<textarea name="notes" rows="3" maxlength="15000" placeholder="What do you see in the chart?"></textarea></label>
      <details class="feedback-extra"><summary>Detailed detector feedback · optional</summary>
      ${(Object.keys(FEEDBACK) as FeedbackField[]).map(field=>`<label>${FEEDBACK[field].question}<select name="${field}" data-feedback-help="${field}" aria-describedby="feedback-${field}-help"><option value="">Choose an answer</option>${Object.entries(feedbackLabels(field)).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('')}</select><small id="feedback-${field}-help">${esc(FEEDBACK[field].help)}</small></label>`).join('')}</details>
      <p class="small muted">Your feedback is recorded for calibration. It does not pass checks or automatically train the detector.</p><p class="form-error" role="alert"></p>
      <div class="review-actions"><button class="btn primary" type="submit" ${blocked?'disabled':''}>${c?.researchTags?.includes('not_matching')?'Save & archive':'Save feedback'}</button><span class="draft-status small muted" aria-live="polite"></span></div>
    </form></dialog>`;
}
function researchTrackingPanel() {
  const c=detail?.row,blocked=c&&(c.archived||!inScope(c.poolData)||knownLowLiquidity(c.poolData));
  return `<div class="chart-actions">${c?(c.archived?'<button class="btn subtle" id="restore-research">Restore to review</button>':`<button class="btn subtle" id="toggle-manual-watch" ${blocked&&!c.manualWatch?'disabled':''}>${c.manualWatch?'Following · unfollow':'Follow chart'}</button>`):''}<button class="btn primary" id="open-feedback" ${blocked?'disabled':''}>Give feedback</button>${c?`<button class="btn subtle" id="open-tier">Move tier</button><button class="icon-btn ${c.pinned?'is-pinned':''}" id="pin-candidate" aria-label="${c.pinned?'Unpin':'Pin'} chart">${icon('pin')}</button><button class="text-btn" id="archive-candidate">${c.archived?'Restore':'Archive'}</button>`:''}</div>`;
}

function stageName(stage:ShortlistStage|null) { return stage?`Tier ${SHORTLIST_STAGES[stage].number} · ${SHORTLIST_STAGES[stage].label}`:'Background observation'; }
function tierPlacementNote() {
  const c=detail?.row;if(!c?.manualStage)return '';
  const blocked=manualStageBlock(c),automatic=automaticShortlistStage(c);
  return `<div class="tier-placement"><strong>Your placement: ${stageName(c.manualStage.stage)}</strong><span>${blocked?esc(blocked):`Scanner: ${stageName(automatic)}. Your placement stays saved until you change it.`}</span></div>`;
}
function tierForm() {
  const c=detail?.row;if(!c)return '';
  const blocked=manualStageBlock(c),automatic=automaticShortlistStage(c);
  return `<dialog class="feedback-dialog" id="tier-dialog" aria-labelledby="tier-title"><div class="section-heading"><h2 id="tier-title">Move ${esc(detail!.pool.symbol)} to a tier</h2><button class="icon-btn" id="close-tier" aria-label="Close tier move">${icon('close')}</button></div>
    <p class="muted">Current: ${stageName(shortlistStage(c))}. Scanner: ${stageName(automatic)}.</p>
    ${blocked?`<p class="form-error">${esc(blocked)} You can still return a saved placement to Automatic.</p>`:''}
    <form id="tier-form" data-draft-key="${esc(c.mint)}:tier">
      <input type="hidden" name="requestId" value="${crypto.randomUUID()}"/>
      <label>Destination tier<select name="stage"><option value="automatic" ${!c.manualStage?'selected':''}>Automatic · follow the scanner</option>${Object.entries(SHORTLIST_STAGES).map(([id,s])=>`<option value="${id}" ${c.manualStage?.stage===id?'selected':''} ${blocked?'disabled':''}>Tier ${s.number} · ${s.label}</option>`).join('')}</select></label>
      <label>Reason for the move · optional<textarea name="reason" maxlength="15000" rows="4" placeholder="What makes this chart belong in a different tier?"></textarea></label>
      <small>Manual placements stay where you put them. Screening checks and Following remain separate. Each move saves your reason and the chart evidence for refining future signals; it does not automatically train the detector.</small>
      <p class="form-error" role="alert"></p><div class="review-actions"><button class="btn primary" type="submit">Save tier move</button><span class="draft-status small muted" aria-live="polite"></span></div>
    </form></dialog>`;
}

function poolContextPanel() {
  const context=detail!.poolContext,p=detail!.pool;
  if(!context)return `<div class="notice small">${isDlmm(p)?'DLMM context pool. Looking for a deeper matching PumpSwap or Raydium pool.':'Matching pools are being compared by exact mint address.'} <button class="text-btn" id="compare-pools">Compare pools</button></div>`;
  const primary=context.pools.find(x=>x.address===context.preferredPool), dlmms=context.pools.filter(isDlmm);
  return `<details class="coverage-detail pool-context" ${isDlmm(p)?'open':''}><summary>${dlmms.length?`${dlmms.length} linked Meteora DLMM pool${dlmms.length===1?'':'s'} · `:''}${context.preferredPool===p.address?'Deepest PumpSwap/Raydium pool selected':context.preferredPool?'Secondary pool selected':'Primary pool not verified'}</summary><p>${esc(context.reason)} Comparison ${ago(context.checkedAt)}. Liquidity is per pool, not the sum across venues.</p>${context.pools.sort((a,b)=>(b.liquidity??0)-(a.liquidity??0)).map(other=>`<div class="linked-pool"><button class="text-btn" data-exact-pool="${esc(other.address)}">${esc(other.venue)} · ${esc(other.route)} · ${short(other.address)}${other.address===context.preferredPool?' · Primary':''}</button><b>${money(other.liquidity)}</b><small>Created ${other.createdAt?date(other.createdAt):'unknown'}${isDlmm(other)&&primary?.createdAt&&other.createdAt?other.createdAt>primary.createdAt?' · DLMM added after this primary pool existed':' · Creation order does not establish a later DLMM addition':''}</small></div>`).join('')}<p class="small muted">A later DLMM addition is research context, not proof of accumulation, shared ownership or token safety. Each pool keeps its own candles and protection checks.</p><button class="text-btn" id="compare-pools">Refresh comparison</button></details>`;
}
function updateMessage(a:RangeAlert) {
  return a.kind==='base_lost'?'Base no longer qualified':a.kind==='base_qualified'?'Base ready for review':a.message;
}
function updateCard(thread:UpdateThread) {
  const a=thread.latest,unread=thread.unreadCount>0;
  return `<article class="source-card alert-card ${unread?'unread':''} ${belowCapTone(a.marketCap)}" aria-label="Updates for ${esc(alertCoinLabel(a))}">
    <div class="notification-heading"><span class="notification-avatar">${esc((a.symbol||a.name||a.mint).slice(0,2).toUpperCase())}</span><div><h2>${esc(alertCoinLabel(a))}</h2><p>${esc(a.venue??'Solana')} · <span class="mono">${esc(a.chartCode)}</span></p></div><span class="tag">${unread?'Unread':'Read'}</span></div>
    <h3 class="notification-event">${esc(updateMessage(a))}</h3>
    <p class="notification-range">${a.kind==='range'?`<span class="range-badge ${a.from}">${RANGE_INFO[a.from].code}</span> → `:''}<span class="range-badge ${a.to} ${belowCapTone(a.marketCap)}">${RANGE_INFO[a.to].code}</span><b>${money(a.marketCap,false)} at this update</b></p>
    <p class="small muted">${date(a.observedAt)} · ${esc(a.source)}${a.eligibility==='pending'||a.eligibility==='excluded'?` · Checks ${a.eligibility==='pending'?'pending':'failed'} at observation`:''}</p>
    <div class="review-actions"><button class="btn primary" data-alert-pool="${esc(a.pool)}" data-alert-id="${a.id}" data-alert-mint="${esc(a.mint)}">Open chart</button>${seeChart(a.mint,a.symbol)}${unread?`<button class="btn mark-read" data-alert-read="${a.id}" data-alert-mint="${esc(a.mint)}">Mark read</button>`:''}</div>
    ${thread.history.length?`<details class="update-history" data-disclosure="updates:${esc(a.mint)}"><summary>Earlier updates (${thread.totalEvents-1})</summary><ol>${thread.history.map(h=>`<li><strong>${esc(updateMessage(h))}</strong><span>${date(h.observedAt)} · ${money(h.marketCap)} · ${esc(h.code)}</span></li>`).join('')}</ol>${thread.totalEvents-1>thread.history.length?'<p class="small muted">Showing the latest 20 earlier updates. Complete history remains in the activity log.</p>':''}</details>`:''}
  </article>`;
}
function alertsPage() {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR UPDATES</div><h1>Updates</h1><p>One card per coin. Its latest change appears first, with earlier updates underneath.</p></div>${data!.unreadAlerts?'<button class="btn mark-read" id="alerts-read-all">Mark all read</button>':''}</div>
    <div class="notification-filters" role="tablist" aria-label="Notification filters">${(['all','unread'] as const).map(filter=>`<button role="tab" aria-selected="${alertsFilter===filter}" class="${alertsFilter===filter?'selected':''}" data-alert-filter="${filter}">${filter==='all'?'All updates':`Unread coins (${data!.unreadAlerts})`}</button>`).join('')}</div>
    ${belowLegend()}<div class="alert-list">${alerts?alerts.threads.map(updateCard).join('')||`<div class="empty"><h3>${alertsFilter==='unread'?'You’re all caught up':'No updates yet'}</h3><p>${alertsFilter==='unread'?'Read coins remain in All updates.':'Updates appear when a consolidation qualifies or a followed chart changes. Preliminary discoveries stay quiet.'}</p></div>`:'<div class="empty"><h3>Loading updates…</h3></div>'}</div>
    <div class="list-footer"><span>${data!.unreadAlerts} coins with unread updates</span><div><button class="text-btn" id="alerts-latest">Latest</button>${alerts?.nextBefore?'<button class="btn subtle" id="alerts-older">Older coins</button>':''}</div></div>
    <p class="small muted">A250 = above $250k · R30-250 = $30k–$250k · B30 = below $30k. Updates record what changed at that time; open the chart for its current assessment.</p>`;
}
function activityParams() {
  const q=new URLSearchParams();if(activityCategory)q.set('category',activityCategory);if(activityEntity)q.set('entity',activityEntity);return q;
}
function activityPage() {
  return `<div class="page-heading"><div><div class="eyebrow">PERSISTENT AUDIT HISTORY</div><h1>Every decision has a trail.</h1><p>Discoveries, observations, checks, source gaps and your actions.</p></div><a class="btn primary" href="/api/activity/export?${esc(activityParams().toString())}" download>${icon('download')} Export history</a></div>
    <div class="notice">Logging starts when this feature was enabled. Earlier observations remain in their original records; missing past events are not invented. Credentials and program binaries are excluded.</div>
    <section class="list-panel"><form id="activity-filter" class="filters"><select name="category" aria-label="Activity category">${['','base','shortlist','tier-review','drawdown','outcome','history','alert','origin','supply','liquidity','pool-context','discovery','migration','metrics','candles','screening','detector','controls','trading','grouping','feedback','review','settings','source','request','error','system'].map(c=>`<option value="${c}" ${activityCategory===c?'selected':''}>${c||'All activity'}</option>`).join('')}</select><input name="entity" class="activity-search" aria-label="Token mint or source ID" placeholder="Token mint or source ID (exact)" value="${esc(activityEntity)}"/><button class="btn subtle" type="submit">Filter</button></form>
    <div class="table-scroll"><table><thead><tr><th>Time</th><th>Activity</th><th>Evidence</th></tr></thead><tbody>${activity?.events.map(e=>`<tr><td><span class="numeric">${date(e.time)}</span><small>#${e.id} · ${esc(e.category)}</small></td><td><b>${esc(e.summary)}</b><small class="mono">${esc(e.entity)}</small></td><td><details><summary>Inspect</summary><pre class="audit-json">${esc(JSON.stringify(e.data,null,2))}</pre></details></td></tr>`).join('')||'<tr><td colspan="3">No matching events loaded.</td></tr>'}</tbody></table></div>
    <div class="list-footer"><span>${activity?count(activity.total):'…'} matching events · 100 per page</span><div><button class="text-btn" id="activity-latest">Latest</button>${activity?.nextBefore?'<button class="btn subtle" id="activity-older">Older events</button>':''}</div></div></section>
    <p class="muted small">History is retained locally with the database and included in backups. Unchanged candles are not duplicated; corrections preserve both versions. Disk usage is shown in Sources & coverage. This local log is not tamper-proof.</p>`;
}
function feedbackPage() {
  const f=feedback;
  return `<div class="page-heading"><div><div class="eyebrow">REFINING YOUR SETUP</div><h1>Learn from your reviews.</h1><p>A record of what fits, what misses, and how the base develops.</p></div><div class="review-exports"><a class="btn primary" href="/api/feedback/export" download>${icon('download')} Export chart reviews</a><a class="btn subtle" href="/api/tier-reviews/export" download>${icon('download')} Export tier moves</a></div></div>
    <div class="stats"><div class="stat"><span>REVIEWED FORMATIONS</span><strong>${f?.reviewedCharts??0}</strong><small>Latest review per pool and episode</small></div><div class="stat"><span>INITIAL MATCHES</span><strong>${f?.formationCounts.match??0}</strong><small>${f?.formationCounts.partial??0} partial matches</small></div><div class="stat"><span>INITIAL NONMATCHES</span><strong>${f?.formationCounts.no_match??0}</strong><small>${f?.formationCounts.unsure??0} uncertain reviews</small></div><div class="stat"><span>REVIEW HISTORY</span><strong>${(f?.totalReviews??0)+(f?.tierReviews?.total??0)}</strong><small>${f?.tierReviews?.total??0} tier moves · ${f?.withoutDetection??0} charts without a detection</small></div></div>
    <div class="notice">These are your judgments on reviewed charts, not market-wide accuracy. Repeat reviews keep their history without increasing the formation count. No thresholds change automatically. Supply, liquidity-protection and linked DLMM evidence are included in each saved review snapshot; unknown checks are not labeled as confirmed bad coins.</div>
    <section class="settings-card"><h2>How your feedback improves the detector</h2><ol class="method-list"><li>Review good matches, poor matches and imported charts the detector missed.</li><li>Revisit developing bases over days or weeks. Save the new judgment when it changes.</li><li>Use recurring reasons to propose a specific rule or scope change.</li><li>Compare that proposal against the saved version on later, unseen charts before adopting it. Keep token-control and trading requirements fixed.</li></ol><p class="muted">The first version collects labels and frozen evidence for this process. Automated retraining, missed-chart recall estimates and a validated accuracy score are not implemented.</p>
    ${f&&Object.keys(f.reasonCounts).length?`<p>Latest reasons: ${Object.entries(f.reasonCounts).sort((a,b)=>b[1]-a[1]).map(([key,n])=>`${esc(reasonLabels[key]??key)} (${n})`).join(' · ')}</p>`:''}</section>
    <section class="list-panel"><div class="list-heading"><h2>Tier moves · ${f?.tierReviews?.total??0}</h2></div><div class="table-scroll"><table><thead><tr><th>Chart</th><th>Your move</th><th>Scanner at the time</th><th>Reason</th></tr></thead><tbody>${(f?.tierReviews?.latest??[]).map(r=>`<tr class="select-row" data-feedback-pool="${esc(r.pool)}" tabindex="0" role="button" aria-label="Review tier move for ${esc(short(r.mint))}"><td><b>${esc(data!.pools.find(p=>p.address===r.pool)?.symbol||short(r.mint))}</b><small>${date(r.createdAt)}</small></td><td>${stageName(r.fromStage)} → ${r.toStage?stageName(r.toStage):'Automatic'}</td><td>${stageName(r.automaticStage)}</td><td>${esc(r.reason||'No reason added.')}</td></tr>`).join('')||'<tr><td colspan="4">Use Move tier on a chart to save your placement and an optional reason.</td></tr>'}</tbody></table></div></section>
    <section class="list-panel"><div class="list-heading"><h2>Latest chart judgments</h2></div><div class="table-scroll"><table><thead><tr><th>Chart</th><th>Initial formation</th><th>Base / scope</th><th>Reason</th></tr></thead><tbody>${f?.latest.map(r=>`<tr class="select-row" data-feedback-pool="${esc(r.pool)}" tabindex="0" role="button" aria-label="Review feedback for ${esc(short(r.mint))}"><td><b>${esc(data!.pools.find(p=>p.address===r.pool)?.symbol||short(r.mint))}</b><small>${date(r.createdAt)} · ${r.episodeId===null?'No detection':'Episode '+r.episodeId}</small>${seeChart(r.mint)}</td><td>${esc(formationLabels[r.formation])}</td><td>${esc(baseLabels[r.base])}<small>${esc(scopeLabels[r.scope])}</small></td><td>${esc(reasonLabels[r.reason])}<small>${esc(r.notes.slice(0,160))}</small></td></tr>`).join('')||'<tr><td colspan="4">Open a chart and save Chart feedback to begin. No example judgments have been added.</td></tr>'}</tbody></table></div></section>`;
}
function riskPanel() {
  const r=detail!.risk, c=r.controls, t=r.trading;
  const state=(s:string)=>s==='passed'?'Checked':s==='excluded'?'Excluded':'Pending';
  const authority=(v:string|null)=>!c.authoritiesVerified?'Unverified':v?'Active':'Revoked';
  const manuallyIncluded = r.manualReview?.approved && detail!.row && active(detail!.row);
  const requested=detail!.checksRequestedAt??0, search=detail!.supplySearch, launch=detail!.launchOrigin;
  const progress=detail!.tradingProgress;
  const steps=[['Token controls',c.checkedAt,c.status],['Liquidity protection',r.liquidityProtection?.checkedAt,r.liquidityProtection?.status]] as const;
  const supplyStatus=r.supply?.status==='passed'?'Verified proof saved':r.supply?.status==='excluded'?'Does not meet supply rule'
    :search?.exhausted&&!search.remaining?'Evidence unavailable':search?.exhausted?'Checking earliest transactions':search?'Searching older history':'Queued for launch-origin check';
  return `<div class="evidence risk-panel"><div class="section-heading"><h3>Controls & trading checks</h3><span class="tag ${r.status==='excluded'&&!manuallyIncluded?'bad':''}">${manuallyIncluded&&r.status!=='passed'?'Reviewed by you':state(r.status)}</span></div>
    <div class="verification-progress"><div class="section-heading"><strong>Verification progress</strong><button class="btn subtle" id="recheck-controls" ${!data?.running||!inScope(detail!.pool)||knownLowLiquidity(detail!.pool)||detail!.row?.archived?'disabled':''}>Recheck</button></div>
    ${requested?`<p class="small muted">Refresh requested ${ago(requested)}. Results update as each check returns.</p>`:'<p class="small muted">Followed charts receive priority. Provider limits can delay a check.</p>'}
    <div class="context-grid">${steps.map(([name,at,status])=>`<div><span>${name}</span><b>${requested>(at??0)?'Refresh queued':at?`Last result: ${status==='passed'?'passed':status==='excluded'?'failed':'unverified'}`:'Awaiting first check'}</b><small>${at?`Checked ${ago(at)}`:'No result yet'}</small></div>`).join('')}<div><span>Buy / sell quotes</span><b>${esc(tradingProgressLabel(progress))}</b><small>${progress?.lastQuoteAt?`Last quote pair ${ago(progress.lastQuoteAt)}`:progress?.lastAttemptAt?'Latest result has no complete quote pair':'No quote pair yet'}${progress?.lastAttemptAt?` · Last attempt ${ago(progress.lastAttemptAt)}`:''}</small>${progress?.nextAttemptAt?`<small>Next attempt eligible after ${new Date(progress.nextAttemptAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small>`:''}</div><div><span>Initial supply</span><b>${supplyStatus}</b><small>${r.supply?.status==='passed'?'Verified launch or issuance proof is reused':search?`${search.pages} history batches searched${search.lastAttempt?` · checked ${ago(search.lastAttempt)}`:''}`:'Launch records are checked in batches after token controls pass'}</small></div></div>
    ${progress?`<p class="small muted">${esc(progress.reason)}</p>`:''}
    ${supplyStatus==='Evidence unavailable'?'<p class="small muted">The automatic search could not establish starting supply. Recheck retains that history; it cannot turn missing evidence into a pass.</p>':''}</div>
    <ul class="reasons">${r.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>
    <div class="supply-check"><div class="section-heading"><h4>Pool liquidity protection</h4><span class="tag ${r.liquidityProtection?.status==='passed'?'good':''}">${r.liquidityProtection?.status==='passed'?'LP protected':state(r.liquidityProtection?.status??'pending')}</span></div><div class="context-grid"><div><span>Burned / non-redeemable LP</span><b>${r.liquidityProtection?.burnedPercent===null||r.liquidityProtection?.burnedPercent===undefined?'Unverified':r.liquidityProtection.burnedPercent+'%'}</b></div><div><span>Recognized permanent lock</span><b>${r.liquidityProtection?.lockedPercent===null||r.liquidityProtection?.lockedPercent===undefined?'Unverified':r.liquidityProtection.lockedPercent+'%'}</b></div></div><p class="small muted">${esc(r.liquidityProtection?.reasons.join(' ')??'Pool-specific lock/burn verification pending.')}</p><p class="small muted">${ago(r.liquidityProtection?.checkedAt??null)} checked · Current gate requires all recorded LP rights to have verified protection. Unknown or partial evidence stays pending and is logged separately from confirmed low liquidity. Other locker types and concentrated-liquidity positions need additional adapters.</p>${r.liquidityProtection?.lpMint?`<a class="text-btn" href="https://explorer.solana.com/address/${esc(r.liquidityProtection.lpMint)}" target="_blank" rel="noopener noreferrer">Inspect LP mint ${icon('external')}</a>`:''}</div>
    <div class="supply-check"><div class="section-heading"><h4>1 billion token starting supply</h4><span class="tag ${r.supply?.status==='excluded'?'bad':''}">${state(r.supply?.status??'pending')}</span></div><p class="small muted">This is token count, not dollar market cap. Current supply must be at most 1 billion; a lower supply is allowed with verified 1 billion starting supply.</p><div class="context-grid"><div><span>Current total supply</span><b>${tokenSupply(r.supply?.currentRaw,r.supply?.decimals)}</b></div><div><span>Initial issuance</span><b>${tokenSupply(r.supply?.origin?.raw,r.supply?.origin?.decimals)}</b></div></div><p class="small muted">${esc(r.supply?.reasons.join(' ')??'Supply verification pending')}</p>${r.supply?.origin?`<p class="small muted">${esc(r.supply.origin.source)}</p><a class="text-btn" href="https://explorer.solana.com/${r.supply.origin.account?'address':'tx'}/${esc(r.supply.origin.account??r.supply.origin.signature??'')}" target="_blank" rel="noopener noreferrer">Inspect saved supply evidence ${icon('external')}</a>`:inScope(detail!.pool)?'<details class="coverage-detail"><summary>Provide a creation transaction</summary><p>If automatic history is incomplete, paste the transaction that initialized the mint and issued its initial tokens. It will be checked on-chain; this is not an approval override.</p><form id="supply-proof-form"><label>Transaction signature<input name="signature" required pattern="[1-9A-HJ-NP-Za-km-z]{64,88}" placeholder="Creation transaction signature"/></label><button class="btn subtle" type="submit">Verify starting supply</button></form></details>':''}</div>
    ${launch?`<div class="supply-check"><h4>Launch origin · ${esc(launch.platform)}</h4><p>${launch.graduated?'Graduation verified':'Launch verified · graduation not yet verified'}${launch.destinationPool&&launch.destinationPool!==detail!.pool.address?' · viewing a secondary pool':''}</p><p class="small muted">${esc(launch.notice??'Origin and supply evidence is saved. The selected pool’s current liquidity protection is checked separately.')}</p><a class="text-btn" href="https://explorer.solana.com/address/${esc(launch.account)}" target="_blank" rel="noopener noreferrer">Inspect launch record ${icon('external')}</a></div>`:''}
    <details class="coverage-detail"><summary>Inspect checks and remaining risks</summary>
      <div class="context-grid"><div><span>Mint authority</span><b>${authority(c.mintAuthority)}</b></div><div><span>Freeze authority</span><b>${authority(c.freezeAuthority)}</b></div><div><span>Token program</span><b>${c.programImmutable===null?'Unverified':c.programImmutable?'Immutable':'Upgradeable'}</b></div><div><span>Controls checked</span><b>${ago(c.checkedAt)}</b></div></div>
      <p>${c.slot?`Finalized slot ${c.slot.toLocaleString()}. `:''}Metadata changes and transfer-fee configurations are allowed. Unapproved control extensions are excluded.</p>
      ${(c.notices??[]).length?`<ul class="reasons">${c.notices.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}
      ${c.transferFee?`<p class="mono">Fee-setting authority: ${esc(c.transferFee.configAuthority??'Revoked')}<br/>Fee-collection authority: ${esc(c.transferFee.withdrawAuthority??'Revoked')}</p>`:''}
      ${c.extensions.length?`<p>Extensions: ${esc(c.extensions.join(', '))}</p>`:''}
      ${c.program?`<p><a class="text-btn" href="https://explorer.solana.com/address/${esc(c.program)}" target="_blank" rel="noopener noreferrer">Inspect token program ${icon('external')}</a></p>`:''}
      <h4>25 USDC sample · ${state(t.status)}</h4><p>${esc(t.reasons.join('. '))}</p>
      <div class="context-grid"><div><span>Buy quote impact</span><b>${t.buy?`${t.buy.priceImpactPercent.toFixed(2)}%`:'Unverified'}</b></div><div><span>Sell quote impact</span><b>${t.sell?`${t.sell.priceImpactPercent.toFixed(2)}%`:'Unverified'}</b></div><div><span>Round-trip quote loss</span><b>${t.roundTripLossPercent===null?'Unverified':`${t.roundTripLossPercent.toFixed(2)}%`}</b></div><div><span>Last trading result</span><b>${ago(t.checkedAt)}</b></div></div>
      <p>Screening limits: at least $10k reported pool liquidity, at most 5% impact per quote and 10% round-trip quote loss before network fees. Quotes expire after five minutes; liquidity must have been retrieved within two minutes.</p>
      ${t.buy&&t.sell?`<p>Jupiter routes: ${esc(t.buy.router)} buy / ${esc(t.sell.router)} sell. Routes may use other pools for this mint.</p><p class="mono">Buy route: ${esc(t.buy.pools.join(', '))}<br/>Sell route: ${esc(t.sell.pools.join(', '))}</p>`:''}
      <h4>Scope of these checks</h4><p>Holder concentration, connected wallets and wash trading are not verified. LP protection is shown separately above; unsupported lockers and concentrated-liquidity positions remain unverified. No wallet-specific buy/sell simulation is performed. A quote does not prove you can sell; liquidity and price can change before execution.</p>
    </details>
    ${detail!.row&&(r.manualReview?.approved||t.status!=='passed')?`<details class="coverage-detail"><summary>${r.manualReview?.approved?'Your saved trading review':'Review a trading check'}</summary>${r.manualReview?.approved?`<p class="small muted">Saved ${date(r.manualReview.createdAt)}. ${r.status==='passed'?'Automatic checks currently pass; this review is not needed for eligibility.':'Your review accepts the trading check. Token controls, initial supply and liquidity protection still apply.'}</p><p>${esc(r.manualReview.notes)}</p>`:''}<form id="manual-risk-form" class="feedback-form"><label>${r.manualReview?.approved?'Reason for removing manual inclusion':'Your manual trading-risk review'}<textarea name="notes" rows="2" maxlength="15000" required placeholder="Record what you checked and why you want this coin tracked."></textarea></label><button class="btn subtle" type="submit">${r.manualReview?.approved?'Remove manual inclusion':'Include after my manual review'}</button><small>This changes the trading check only. Your Following selection stays saved.</small></form></details>`:''}
    </div>`;
}
function candleSchedulingPanel() {
  const r=data?.candleScheduling;if(!r)return '';
  const active=r.mode==='priority',minutes=Math.max(1,Math.round((r.asOf-r.since)/60_000)),discovery=r.profile==='discovery';
  return `<section class="settings-card candle-scheduling" id="candle-scheduling" aria-label="Candle request results">
    <div class="section-heading"><div><h2>Candle request results</h2><p class="muted">${active?`${CANDLE_PROFILES[r.profile??'balanced'].label} · ${data?.running?'live':'scanner paused'}`:'Original scheduler is active · priority results remain saved'}</p></div><span class="tag ${active?'good':''}">${active?'Trial on':'Trial off'}</span></div>
    <p class="small muted">Requests for this balance over the last ${minutes} ${minutes===1?'minute':'minutes'}. These measure collection, not trading performance.</p>
    <div class="candle-stats"><div><strong>${r.distinctTokens}</strong><span>Different tokens checked</span></div><div><strong>${r.firstChecks}</strong><span>First chart checks</span></div><div><strong>${r.attempts}</strong><span>Candle requests</span></div><div><strong>${r.providerLimited??r.limited}</strong><span>Gecko rate limits · all work</span></div></div>
    <div class="table-scroll"><table class="candle-allocation"><thead><tr><th>Purpose</th><th>Target share</th><th>Requests</th><th>Due now</th></tr></thead><tbody>${r.shares.map(s=>`<tr><td>${esc(s.label)}</td><td>${s.target}%</td><td>${s.attempts}</td><td>${r.queue[s.key]}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Shares apply while every queue has work; unused turns are shared. ${active?`GeckoTerminal pacing: up to ${r.pace} requests/minute across candles and discovery.`:''} ${r.cooldownUntil>r.asOf?`Provider retry after ${new Date(r.cooldownUntil).toLocaleTimeString()}.`:''}</p>
    ${active&&discovery?`<p class="small">Oldest first check: ${Math.round(r.firstWaitMs/60_000)} minutes waiting · ${r.earlyOverdue} Early signs assessments past freshness · ${r.earlyRefreshes} Early signs responses up to date.</p><p class="small muted">Early signs refreshes enter the queue every 10 minutes. Capacity and provider delays can still make them late. Stale evidence cannot qualify a chart.</p>`:''}
    <details class="coverage-detail" data-disclosure="candle-results"><summary>Collection detail & recent requests</summary>
      <p class="small muted">${r.newBars.toLocaleString()} new candles saved · ${r.stale} responses without the latest completed interval. Oldest due check across all queues: ${Math.round(r.oldestWaitMs/60_000)} minutes waiting. ${r.providerAttempts??r.attempts} total Gecko requests including discovery; ${r.limited} candle requests were rate limited. ${r.sampledRevisits} completed quiet revisits found ${r.sampledQualified} qualifying base assessments. This is an exploration sample, not a measured overall miss rate.</p>
      ${r.profileBaseline?`<p class="small muted">Before the latest balance change: ${r.profileBaseline.firstChecks} first chart checks from ${r.profileBaseline.attempts} requests over ${r.profileBaseline.minutes} minutes; ${r.profileBaseline.firstWaiting} first checks waiting, oldest ${Math.round(r.profileBaseline.firstWaitMs/60_000)} minutes. Different periods and provider conditions limit comparison.</p>`:''}
      ${r.baseline?`<p class="small muted">Before this trial: ${r.baseline.attempts} candle responses, ${r.baseline.successes} successful and ${r.baseline.limited} rate limited over the preceding ${r.baseline.minutes} minutes. Different observation periods and provider conditions limit direct comparison.</p>`:''}
      ${r.recent.length?`<div class="candle-recent">${r.recent.map(x=>`<div><b>${esc(x.symbol||x.mint.slice(0,8))}</b> <a class="text-btn" href="https://jup.ag/tokens/${esc(x.mint)}" target="_blank" rel="noopener noreferrer">jup</a><span>${esc(x.outcome)} · ${x.newBars} new candles · ${ago(x.time)}</span><p>${esc(x.reason)}</p></div>`).join('')}</div>`:'<p class="small muted">Waiting for the first recorded trial requests.</p>'}
    </details>
    <div class="candle-actions">${active?`<button class="btn subtle" id="toggle-candle-profile">${discovery?'Restore earlier candle balance':'Use discovery & Early signs priority'}</button>`:''}<button class="btn ${active?'subtle':'primary'}" id="toggle-candle-policy">${active?'Use original scheduler':'Use prioritised scheduling'}</button><button class="btn subtle" id="refresh-candle-results">Refresh results</button></div>
    <p class="small muted">Switching takes effect without a restart. Charts, tags, feedback and collected evidence stay saved. A request already in progress may finish.</p>
  </section>`;
}
function bindCandleControls() {
  document.querySelector<HTMLButtonElement>('#toggle-candle-profile')?.addEventListener('click',async e=>{
    (e.currentTarget as HTMLButtonElement).disabled=true;
    try {
      const profile=data?.candleScheduling?.profile==='discovery'?'balanced':'discovery';
      data!.candleScheduling=await api('/api/candle-scheduler',{method:'PUT',body:JSON.stringify({profile})});
      updateCandlePanel();toast(profile==='balanced'?'Earlier candle balance restored. Saved data retained.':'Discovery & Early signs priority enabled.');
    }catch(error){toast((error as Error).message,true);(e.target as HTMLButtonElement).disabled=false;}
  });
  document.querySelector<HTMLButtonElement>('#toggle-candle-policy')?.addEventListener('click',async e=>{
    (e.currentTarget as HTMLButtonElement).disabled=true;
    try {
      const mode=data?.candleScheduling?.mode==='priority'?'legacy':'priority';
      data!.candleScheduling=await api('/api/candle-scheduler',{method:'PUT',body:JSON.stringify({mode})});
      updateCandlePanel();toast(mode==='legacy'?'Previous scheduling restored. Saved data retained.':'Prioritised scheduling enabled.');
    }catch(error){toast((error as Error).message,true);(e.target as HTMLButtonElement).disabled=false;}
  });
  document.querySelector('#refresh-candle-results')?.addEventListener('click',async()=>{
    try{data!.candleScheduling=await api('/api/candle-scheduler');updateCandlePanel();}catch(error){toast((error as Error).message,true);}
  });
}
function updateCandlePanel() {
  const panel=document.querySelector('#candle-scheduling');if(!panel)return;
  const open=!!panel.querySelector('details[open]');panel.outerHTML=candleSchedulingPanel();
  if(open)document.querySelector('#candle-scheduling details')?.setAttribute('open','');
  bindCandleControls();
}
function healthPage() {
  return `<div class="page-heading"><div><div class="eyebrow">COLLECTION & COVERAGE</div><h1>Know what you’re seeing.</h1><p>Live connection status, request usage, and the gaps still to close.</p></div><button class="btn ${data!.running?'subtle':'primary'}" id="toggle-scanner">${data!.running?'Pause scanner':'Resume scanner'}</button></div>
    <div class="stats"><div class="stat"><span>REQUESTS TODAY</span><strong>${count(data!.requestsToday)}</strong><small>All public HTTP sources · UTC day</small></div><div class="stat"><span>METRIC CHECKS DUE</span><strong>${count(data!.pendingMetrics)}</strong><small>Batched requests share the free allowance</small></div><div class="stat"><span>CANDLE CHECKS DUE</span><strong>${count(data!.pendingCandles)}</strong><small>Queued, never silently deleted</small></div><div class="stat"><span>LOCAL STORAGE</span><strong>${(data!.storageBytes/1048576).toFixed(1)}<em> MB</em></strong><small>Persistent SQLite database</small></div></div>
    ${candleSchedulingPanel()}
    <div class="source-grid">${data!.health.map(h=>`<article class="source-card"><div class="section-heading"><h3>${esc(h.name)}</h3><span class="tag ${h.state==='ok'?'good':h.state==='error'?'bad':''}">${h.state==='ok'?'Responding':h.state==='error'?'Needs attention':h.state==='limited'?'Partial coverage':esc(h.state)}</span></div><p>${esc(h.detail)}</p><div class="source-meta"><span>Last success <b>${ago(h.lastSuccess)}</b></span><span>Requests <b>${count(h.requests)}</b></span><span>Errors <b>${count(h.errors)}</b></span></div></article>`).join('')}</div>
    <section class="coverage-table"><div class="section-heading"><h2>Route coverage</h2><span class="tag">Pilot · incomplete coverage</span></div><p class="muted">A connected source does not mean every graduation is captured. These limitations stay visible.</p><table><thead><tr><th>Route</th><th>Status</th><th>What is covered</th></tr></thead><tbody>${data!.coverage.map(c=>`<tr><td><b>${esc(c.route)}</b></td><td><span class="tag">${esc(c.state)}</span></td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></section>
    <div class="notice">This local scanner runs while its server is open and your computer is awake. Public feeds are rate limited. No wallet, paid trade stream, automated AI calls or orders are used.</div>`;
}
function settingsPage() {
  const s=data!.settings;
  return `<div class="page-heading"><div><div class="eyebrow">EXPLAINABLE DETECTION</div><h1>Detection settings</h1><p>Early pump evidence feeds the consolidation assessment. Only qualified bases enter the final shortlist stage, Ready to review.</p></div><span class="tag good">Rules v0.2</span></div>
    ${candleSchedulingPanel()}
    <div class="settings-grid"><section class="settings-card"><h2>Detection thresholds</h2><p class="muted">These are starting hypotheses to calibrate against your chart examples. They do not predict a breakout.</p><form id="settings-form">
    <label>Minimum close-to-close rise<div class="input-unit"><input type="number" name="riseMultiple" value="${s.riseMultiple}" min="1.1" max="20" step=".1" required/><span>×</span></div><small>Across 15, 30, 60, 120 or 180 minutes.</small></label>
    <label>Minimum relative volume<div class="input-unit"><input type="number" name="volumeMultiple" value="${s.volumeMultiple}" min="1.1" max="50" step=".1" required/><span>×</span></div><small>Mean volume of the rise versus the preceding median.</small></label>
    <label>Minimum active candles<input type="number" name="minActiveBars" value="${s.minActiveBars}" min="3" max="36" step="1" required/></label>
    <div class="form-two"><label>Pullback from peak · minimum<input type="number" name="pullbackMin" value="${s.pullbackMin*100}" min="5" max="80" step="1" required/><small>Percent</small></label><label>Pullback from peak · maximum<input type="number" name="pullbackMax" value="${s.pullbackMax*100}" min="10" max="99" step="1" required/><small>Percent</small></label></div><button type="submit" class="btn primary">Save detector settings</button></form></section>
    <div><section class="settings-card"><h2>Consolidation criteria</h2><p class="muted">Initial calibration: 1h–2 week windows, a closing-price band up to 30% (around the slope for rising bases), at least 3 floor and 2 ceiling tests, 85% candle coverage and 65% active candles. Activity is measured within the coin’s own chart; there is no universal dollar-volume minimum. Sideways drift is limited; a rising base needs repeated pullbacks and a gentler slope than the earlier pump. Rising and tightening add review priority, not a probability. The volume-supported pump must begin within six hours of pool creation, used as a launch proxy. These are versioned hypotheses to calibrate, not validated prediction rates.</p><h2>What stays fixed</h2><ul class="principles"><li>${icon('check')}Historical qualification stays with the coin.</li><li>${icon('check')}$30k–$250k is a preference for the later base.</li><li>${icon('check')}Initial peaks may exceed $250k.</li><li>${icon('check')}Below $30k changes grouping, not eligibility.</li><li>${icon('check')}Hours can qualify; sustained ranges receive more weight.</li><li>${icon('check')}Only you archive or restore candidates.</li></ul></section>
    <section class="settings-card"><h2>Mandatory eligibility checks</h2><p class="muted">Initial issuance must be exactly 1 billion tokens, and current total supply at most 1 billion. Burned-down supplies are allowed when the initial issuance is verified. Verified launch accounts are reused; transaction history is a fallback for followed or promising charts. Unverified origins stay pending. This is separate from dollar market cap.</p><p class="muted">Below $1,000 reported liquidity is a hard exclusion. Unverified or partially protected liquidity stays pending until all LP rights have verified burn or recognized permanent-lock protection. Manual trading review cannot override these requirements.</p><p class="muted">Revoked mint and freeze authorities and no unapproved control extensions. Standard Solana token programs are allowed; shared Token-2022 upgradeability is disclosed as a notice. Metadata and transfer-fee configurations may remain mutable.</p><p class="muted">A 25 USDC buy and reverse sell quote is checked against liquidity and impact limits. Your explicit manual trading-risk review can retain a named coin with its trading evidence available under Screening details. Mint/freeze, extension and supply checks cannot be overridden by manual review, pinning or a chart label.</p><p class="small muted">Passing permits research review, not a trading-safety guarantee. Original chart evidence and below-$30k history remain stored even when eligibility changes.</p></section>
    <section class="settings-card"><h2>How the detector works</h2><ol class="method-list"><li>Discover pools and collect price, liquidity and reported volume.</li><li>Prioritize actual five-minute candles for active pools.</li><li>Look for a sustained rise with multiple advancing closes.</li><li>Require elevated volume for a supported signal. Missing baselines stay provisional.</li><li>Track the pullback and preserve the subsequent chart for your review.</li></ol><p class="small muted">Six-hour episode cooldown avoids repeated signals from one pump. No-trade or missing intervals are not filled. Price-rise windows span 15 minutes to six hours. Volume compares with this coin’s preceding candles; a missing baseline stays provisional.</p></section></div></div>`;
}
function drawChart() {
  const el=document.querySelector<HTMLDivElement>('#chart'); if (!el || !detail) return;
  const raw=timeframe===1?detail.candles1m:aggregateCandles(detail.candles,timeframe), factor=marketCapFactor(detail.pool);
  if(chartValue==='marketCap'&&factor===null)return;
  const bars=chartValue==='marketCap'?scaleChart(raw,factor!):raw;
  if(!(timeframe===1?detail.candles1m:detail.candles).length)return;
  if (!bars.length) { el.innerHTML='<div class="chart-empty"><p>Not enough complete candles for this timeframe.</p><small>Try 5m. Missing intervals are not manufactured.</small></div>'; return; }
  chart=createChart(el,{ autoSize:true, layout:{background:{type:ColorType.Solid,color:'#202226'},textColor:'#a0a6af',fontFamily:'"SFMono-Regular", Consolas, monospace',fontSize:10,attributionLogo:false},
    grid:{vertLines:{color:'#2e3137'},horzLines:{color:'#2e3137'}}, rightPriceScale:{borderColor:'#3a3e46',mode:logScale?PriceScaleMode.Logarithmic:PriceScaleMode.Normal},
    timeScale:{borderColor:'#3a3e46',timeVisible:true,secondsVisible:false}, crosshair:{vertLine:{color:'#8490a2',labelBackgroundColor:'#414956'},horzLine:{color:'#8490a2',labelBackgroundColor:'#414956'}} });
  const series=chart.addSeries(CandlestickSeries,{upColor:'#82c7b3',downColor:'#dc9295',wickUpColor:'#82c7b3',wickDownColor:'#dc9295',borderVisible:false,
    priceFormat:chartValue==='marketCap'?{type:'custom',minMove:.01,formatter:(value:number)=>money(value)}:{type:'price',precision: Math.min(12,Math.max(2,Math.ceil(-Math.log10(bars.at(-1)!.close))+4)),minMove:10**-Math.min(12,Math.max(2,Math.ceil(-Math.log10(bars.at(-1)!.close))+4))}});
  series.setData(bars.map(c=>({...c,time:c.time as UTCTimestamp})));
  const volumes=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false},1);
  volumes.setData(bars.map(c=>({time:c.time as UTCTimestamp,value:c.volume,color:c.close>=c.open?'#57988988':'#b56f7588'})));
  chart.panes()[1]?.setHeight(75);
  const markers=(detail.episodes.filter(e=>e.pool===detail!.pool.address).sort((a,b)=>a.signal.trigger-b.signal.trigger).map((e,index)=>{
    const time=Math.floor(e.signal.trigger/(timeframe*60))*timeframe*60;
    const text=['Initial pump','Second pump','Third pump'][index]??`Pump ${index+1}`;
    return {time:time as UTCTimestamp,position:'belowBar' as const,color:'#d3dce9',shape:'arrowUp' as const,text};
  })).filter(m=>bars.some(b=>b.time===m.time));
  const base=detail.base;
  if(base?.start&&base.floor&&base.ceiling&&base.status==='qualified') {
    const factor=chartValue==='marketCap'?marketCapFactor(detail.pool)??1:1;
    for(const [initial,final,title] of [[base.floorStart??base.floor,base.floor,'Base floor'],[base.ceilingStart??base.ceiling,base.ceiling,'Base ceiling']] as const) {
      const guide=chart.addSeries(LineSeries,{color:'#91a9bd',lineWidth:1,lineStyle:2,lastValueVisible:false,
        priceLineVisible:false,crosshairMarkerVisible:false,title,priceFormat:series.options().priceFormat});
      guide.setData(bars.filter(c=>c.time*1000>=base.start!&&c.time*1000<base.end!).map(c=>({time:c.time as UTCTimestamp,
        value:initial*Math.pow(final/initial,(c.time*1000-base.start!)/(base.end!-base.start!))*factor})));
    }
    const time=Math.floor(base.start/1000/(timeframe*60))*timeframe*60;
    if(bars.some(b=>b.time===time))markers.push({time:time as UTCTimestamp,position:'belowBar',color:'#91a9bd',shape:'arrowUp',text:'Base begins'});
  }
  markers.sort((a,b)=>Number(a.time)-Number(b.time));
  if(markers.length) createSeriesMarkers(series,markers);
  if (chartRange) chart.timeScale().setVisibleLogicalRange(chartRange); else chart.timeScale().fitContent();
  chart.subscribeCrosshairMove(param=>{
    const value=param.seriesData.get(series) as any, legend=document.querySelector('#chart-legend');
    const format=chartValue==='marketCap'?(n:number)=>money(n,false):price;
    if(value?.open && legend) legend.textContent=`${chartValue==='marketCap'?'Est. cap':'Price'} · O ${format(value.open)}   H ${format(value.high)}   L ${format(value.low)}   C ${format(value.close)}`;
  });
}
async function requestMinuteChart() {
  if(timeframe!==1||!detail||!inScope(detail.pool)||knownLowLiquidity(detail.pool)||!data?.running||!reviewViews.includes(view))return;
  await api('/api/chart/1m',{method:'POST',body:JSON.stringify({address:detail.pool.address})});
}
async function selectPool(address: string, exact=false) {
  selectedExact=exact;
  const ticket=++fetchNumber; selected=address; loadingDetail=true; detail=null; chartRange=null; render();
  try {
    let value=await api<Detail>(`/api/pools/${address}`);
    if(!exact&&value.poolContext?.preferredPool&&value.poolContext.preferredPool!==address)value=await api<Detail>(`/api/pools/${value.poolContext.preferredPool}`);
    if(ticket!==fetchNumber)return;detail=value;selected=value.pool.address;
    if(!inScope(value.pool))view='history';else if(knownLowLiquidity(value.pool))view='ignored';else if(['history','ignored'].includes(view))view='pools';
    if(!value.poolContext||Date.now()-value.poolContext.checkedAt>120_000)await api('/api/pool-context',{method:'POST',body:JSON.stringify({mint:value.pool.mint})});
    await requestMinuteChart();
    return true;
  }
  catch(error){toast((error as Error).message,true);} finally { if(ticket===fetchNumber){loadingDetail=false;render();} }
}
async function openAlertChart(pool: string, id: number, mint: string) {
  view='pools';query='';venue='All venues';researchTagFilter='';pinned=false;
  if(!await selectPool(pool,true))return;
  try {await api('/api/alerts/read',{method:'POST',body:JSON.stringify({mint,through:id})});await load(true);}
  catch(error){toast((error as Error).message,true);}
}
async function action(path: string, method: string, body: unknown, message: string) {
  try { await api(path,{method,body:JSON.stringify(body)}); toast(message); await load(true); }
  catch(error){toast((error as Error).message,true);}
}
function bind() {
  bindCandleControls();
  document.querySelectorAll<HTMLElement>('[data-tier-pool]').forEach(el=>el.addEventListener('click',async()=>{
    if(await selectPool(el.dataset.tierPool!))document.querySelector<HTMLDialogElement>('#tier-dialog')?.showModal();
  }));
  document.querySelector('#open-tier')?.addEventListener('click',()=>document.querySelector<HTMLDialogElement>('#tier-dialog')?.showModal());
  document.querySelector('#close-tier')?.addEventListener('click',()=>{captureDrafts();document.querySelector<HTMLDialogElement>('#tier-dialog')?.close();});
  document.querySelector('#tier-dialog')?.addEventListener('close',()=>{captureDrafts();document.querySelector<HTMLButtonElement>('#open-tier')?.focus();});
  document.querySelector<HTMLFormElement>('#tier-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget as HTMLFormElement,values=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!,error=form.querySelector('.form-error')!;
    const target=String(values.get('stage')),stage=target==='automatic'?null:target as ShortlistStage;
    form.dataset.dirty='true';captureDrafts();button.disabled=true;error.textContent='';
    try {
      await api('/api/tier-reviews',{method:'POST',body:JSON.stringify({mint:detail!.row!.mint,stage,reason:String(values.get('reason')||''),requestId:String(values.get('requestId'))})});
      form.dataset.dirty='false';draftCache.delete(form.dataset.draftKey!);try{sessionStorage.removeItem(`review-draft:${form.dataset.draftKey}`);}catch{}
      document.querySelector<HTMLDialogElement>('#tier-dialog')?.close();
      if(stage&&view==='shortlist')shortlistSelection=stage;
      await load(true);toast(stage?`Moved to ${stageName(stage)}. Reason and chart evidence saved.`:'Automatic placement restored. Move history retained.');
    }catch(err){error.textContent=(err as Error).message;button.disabled=false;}
  });
  document.querySelectorAll<HTMLElement>('[data-shortlist-stage]').forEach(el=>el.addEventListener('click',()=>{
    shortlistSelection=el.dataset.shortlistStage as ShortlistStage;render();
    document.querySelector<HTMLButtonElement>(`[data-shortlist-stage="${shortlistSelection}"]`)?.focus({preventScroll:true});
  }));
  document.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]').forEach(el=>{
    const key=el.dataset.disclosure==='navigation'?'navigation':`${selected}:${el.dataset.disclosure}`;
    if(disclosureState.has(key))el.open=disclosureState.get(key)!;
    el.addEventListener('toggle',()=>disclosureState.set(key,el.open));
  });
  document.querySelectorAll<HTMLElement>('a.external-chart').forEach(el=>{
    el.addEventListener('click',event=>event.stopPropagation());
    el.addEventListener('keydown',event=>event.stopPropagation());
  });
  document.querySelector('.brand')?.addEventListener('click',e=>{e.preventDefault();view='shortlist';shortlistSelection='ready';group='all';detail=null;selected=null;++fetchNumber;render();});
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(el=>el.addEventListener('click',()=>{view=el.dataset.view!;if(view==='shortlist')shortlistSelection='ready';group='all';query='';venue='All venues';researchTagFilter='';capFilter='all';selected=null;detail=null;loadingDetail=false;++fetchNumber;if(view==='alerts'){alertsBefore=null;alerts=null;}render();void load(true);}));
  document.querySelectorAll<HTMLElement>('[data-feedback-pool]').forEach(el=>{const open=()=>{view='pools';void selectPool(el.dataset.feedbackPool!);};el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter')open();});});
  document.querySelectorAll<HTMLElement>('[data-group]').forEach(el=>el.addEventListener('click',()=>{group=el.dataset.group as WatchlistFilter;view=group==='manual'?'following':group==='not_matching'||group==='archived'?'archive':'watchlist';if(el.closest('.sidebar')||group==='manual'){query='';researchTagFilter='';venue='All venues';pinned=false;}render();}));
  document.querySelector('#alerts-read-all')?.addEventListener('click',()=>{if(data!.latestAlert)void action('/api/alerts/read','POST',{through:data!.latestAlert.id},'Notifications marked read');});
  document.querySelectorAll<HTMLElement>('[data-alert-read]').forEach(el=>el.addEventListener('click',()=>action('/api/alerts/read','POST',{mint:el.dataset.alertMint,through:Number(el.dataset.alertRead)},'Coin updates marked read')));
  document.querySelectorAll<HTMLElement>('[data-alert-pool]').forEach(el=>el.addEventListener('click',()=>openAlertChart(el.dataset.alertPool!,Number(el.dataset.alertId),el.dataset.alertMint!)));
  document.querySelectorAll<HTMLElement>('[data-alert-filter]').forEach(el=>el.addEventListener('click',()=>{alertsFilter=el.dataset.alertFilter as 'all'|'unread';alertsBefore=null;alerts=null;render();void load(true);}));

  document.querySelectorAll<HTMLElement>('[data-alert-copy]').forEach(el=>el.addEventListener('click',()=>navigator.clipboard.writeText(el.dataset.alertCopy!).then(()=>toast('Token address copied')).catch(()=>toast('Clipboard unavailable',true))));
  document.querySelector('#alerts-older')?.addEventListener('click',()=>{alertsBefore=alerts?.nextBefore??null;alerts=null;render();void load(true);});
  document.querySelector('#alerts-latest')?.addEventListener('click',()=>{alertsBefore=null;alerts=null;render();void load(true);});
  document.querySelectorAll<HTMLElement>('[data-pool]').forEach(el=>{el.addEventListener('click',()=>selectPool(el.dataset.pool!));el.addEventListener('keydown',e=>{if(e.key==='Enter')selectPool(el.dataset.pool!);});});
  document.querySelectorAll<HTMLElement>('[data-exact-pool]').forEach(el=>el.addEventListener('click',()=>selectPool(el.dataset.exactPool!,true)));
  document.querySelector('#compare-pools')?.addEventListener('click',()=>action('/api/pool-context','POST',{mint:detail!.pool.mint},'Same-mint pool comparison queued'));
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input',e=>{
    const input=e.target as HTMLInputElement,pos=input.selectionStart;query=input.value;render();const next=document.querySelector<HTMLInputElement>('#search');next?.focus();next?.setSelectionRange(pos,pos);
  });
  document.querySelector<HTMLSelectElement>('#venue')?.addEventListener('change',e=>{venue=(e.target as HTMLSelectElement).value;render();});
  document.querySelector<HTMLSelectElement>('#research-tag-filter')?.addEventListener('change',e=>{researchTagFilter=(e.target as HTMLSelectElement).value as ResearchTag|'';render();});
  document.querySelector('#filter-pinned')?.addEventListener('click',()=>{pinned=!pinned;render();});
  document.querySelector('#add-pool')?.addEventListener('click',importDialog);
  document.querySelector('#back-to-list')?.addEventListener('click',()=>{++fetchNumber;detail=null;selected=null;loadingDetail=false;chartRange=null;render();});
  document.querySelector<HTMLSelectElement>('#cap-filter')?.addEventListener('change',e=>{capFilter=(e.target as HTMLSelectElement).value;render();});
  document.querySelector<HTMLSelectElement>('#check-filter')?.addEventListener('change',e=>{group=(e.target as HTMLSelectElement).value as WatchlistFilter;render();});
  document.querySelector('#close-detail')?.addEventListener('click',()=>{++fetchNumber;detail=null;selected=null;loadingDetail=false;chartRange=null;render();});
  document.querySelector('#copy-mint')?.addEventListener('click',()=>navigator.clipboard.writeText(detail!.pool.mint).then(()=>toast('Token address copied')).catch(()=>toast('Clipboard unavailable',true)));
  document.querySelectorAll<HTMLElement>('[data-timeframe]').forEach(el=>el.addEventListener('click',()=>{timeframe=Number(el.dataset.timeframe);chartRange=null;if(chart){chart.remove();chart=null;}render();void requestMinuteChart().catch(error=>toast(error.message,true));}));
  document.querySelectorAll<HTMLElement>('[data-chart-value]').forEach(el=>el.addEventListener('click',()=>{chartValue=el.dataset.chartValue as 'price'|'marketCap';render();}));
  document.querySelectorAll<HTMLSelectElement>('[data-feedback-help]').forEach(el=>el.addEventListener('change',()=>{const field=el.dataset.feedbackHelp as FeedbackField;document.querySelector(`#feedback-${field}-help`)!.textContent=feedbackHelp(field,el.value);}));
  document.querySelector('#log-scale')?.addEventListener('click',()=>{logScale=!logScale;render();});
  for(const id of ['refresh-pool','request-candles'])document.querySelector(`#${id}`)?.addEventListener('click',()=>action(timeframe===1?'/api/chart/1m':'/api/refresh','POST',{address:detail!.pool.address},'Chart check queued within the free request budget'));
  document.querySelector('#pin-candidate')?.addEventListener('click',()=>action(`/api/candidates/${detail!.row!.mint}`,'PATCH',{pinned:!detail!.row!.pinned},detail!.row!.pinned?'Candidate unpinned':'Candidate pinned'));
  document.querySelector('#archive-candidate')?.addEventListener('click',()=>action(`/api/candidates/${detail!.row!.mint}`,'PATCH',{archived:!detail!.row!.archived},detail!.row!.archived?'Candidate restored':'Candidate archived; history retained'));
  document.querySelector('#restore-research')?.addEventListener('click',()=>action(`/api/candidates/${detail!.row!.mint}`,'PATCH',{archived:false},'Restored for review. Not my setup removed; screening checks still apply.'));
  document.querySelector<HTMLButtonElement>('#toggle-manual-watch')?.addEventListener('click',e=>{
    const c=detail!.row!;(e.currentTarget as HTMLButtonElement).disabled=true;
    void action(`/api/candidates/${c.mint}`,'PATCH',{manualWatch:!c.manualWatch},c.manualWatch?'Removed from My selections; tags and history retained':'Added to your watchlist. Screening checks keep their current status.');
  });
  document.querySelector('#open-feedback')?.addEventListener('click',()=>{document.querySelector<HTMLDialogElement>('#feedback-dialog')?.showModal();});
  document.querySelector('#close-feedback')?.addEventListener('click',()=>{captureDrafts();document.querySelector<HTMLDialogElement>('#feedback-dialog')?.close();});
  document.querySelector('#feedback-dialog')?.addEventListener('close',()=>{captureDrafts();document.querySelector<HTMLButtonElement>('#open-feedback')?.focus();});
  document.querySelector('#show-checks')?.addEventListener('click',()=>{const section=document.querySelector<HTMLDetailsElement>('.evidence-disclosure');if(section){section.open=true;section.scrollIntoView({behavior:'smooth',block:'start'});}});
  document.querySelector<HTMLButtonElement>('#recheck-controls')?.addEventListener('click',e=>{(e.currentTarget as HTMLButtonElement).disabled=true;void action('/api/checks/refresh','POST',{address:detail!.pool.address},'Verification refresh queued; saved supply proof is reused');});
  document.querySelectorAll<HTMLFormElement>('form[data-draft-key]').forEach(form=>{
    const change=()=>{form.dataset.dirty='true';captureDrafts();const status=form.querySelector('.draft-status');if(status)status.textContent='Draft kept in this tab';};
    form.addEventListener('input',change);form.addEventListener('change',change);
  });
  document.querySelector<HTMLFormElement>('#research-tags-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget as HTMLFormElement,f=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!,error=form.querySelector('.form-error')!;
    const answers=Object.fromEntries((Object.keys(FEEDBACK) as FeedbackField[]).map(field=>[field,String(f.get(field)||'')]));
    const any=Object.values(answers).some(Boolean),complete=Object.values(answers).every(Boolean);
    if(any&&!complete){error.textContent='Complete all four detailed answers, or leave all four blank to save just your tags and notes.';return;}
    error.textContent='';button.disabled=true;
    try {
      await api('/api/review',{method:'POST',body:JSON.stringify({pool:detail!.pool.address,researchTags:f.getAll('tags'),notes:String(f.get('notes')||''),assessment:complete?answers:null})});
      form.dataset.dirty='false';draftCache.delete(form.dataset.draftKey!);try{sessionStorage.removeItem(`review-draft:${form.dataset.draftKey}`);}catch{}
      document.querySelector<HTMLDialogElement>('#feedback-dialog')?.close();
      toast(f.getAll('tags').includes('not_matching')?'Archived as Not my setup. Your evidence and feedback are saved.':'Feedback saved with chart evidence.');
      await load(true);
    }catch(err){error.textContent=(err as Error).message;button.disabled=false;}
  });
  document.querySelector<HTMLInputElement>('#research-tags-form input[value="not_matching"]')?.addEventListener('change',e=>{
    document.querySelector<HTMLButtonElement>('#research-tags-form button[type="submit"]')!.textContent=(e.currentTarget as HTMLInputElement).checked?'Save & archive':'Save feedback';
  });
  document.querySelector<HTMLFormElement>('#manual-risk-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget as HTMLFormElement);void action('/api/manual-risk-review','POST',{mint:detail!.pool.mint,approved:!detail!.risk.manualReview?.approved,notes:f.get('notes')},'Manual review saved. Mandatory token controls still apply.');});
  document.querySelector<HTMLFormElement>('#supply-proof-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget as HTMLFormElement);void action('/api/supply-origin','POST',{address:detail!.pool.address,signature:f.get('signature')},'Starting-supply transaction queued for verification');});
  document.querySelector<HTMLFormElement>('#activity-filter')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget as HTMLFormElement);activityCategory=String(f.get('category'));activityEntity=String(f.get('entity')).trim();activityBefore=null;void load(true);});
  document.querySelector('#activity-older')?.addEventListener('click',()=>{activityBefore=activity?.nextBefore??null;void load(true);});
  document.querySelector('#activity-latest')?.addEventListener('click',()=>{activityBefore=null;void load(true);});
  document.querySelector('#toggle-scanner')?.addEventListener('click',()=>action('/api/scanner','POST',{enabled:!data!.running},data!.running?'Scanner paused':'Scanner resumed'));
  document.querySelector<HTMLFormElement>('#settings-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget as HTMLFormElement),settings=Object.fromEntries([...f].map(([k,v])=>[k,Number(v)/(k.startsWith('pullback')?100:1)]));void action('/api/settings','PUT',settings,'Settings saved. New checks use these thresholds; original evidence stays.');});
}
function importDialog() {
  const dialog=document.createElement('dialog');dialog.className='import-dialog';
  dialog.innerHTML=`<form id="import-form"><div class="section-heading"><h2>Add a token or pool</h2><button type="button" class="icon-btn" id="dismiss-dialog" aria-label="Close">${icon('close')}</button></div><p>Paste a Solana address. We’ll resolve its live pool and run the same candle detector.</p><label>Token mint or pool address<input name="address" placeholder="Solana address…" autocomplete="off" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"/></label><p class="small muted">PumpSwap and Raydium. Meteora is paused. Adding a pool does not automatically qualify it as a candidate.</p><div class="dialog-error" role="alert"></div><button class="btn primary" type="submit">Find pool ${icon('arrow')}</button></form>`;
  document.body.append(dialog);dialog.showModal();dialog.querySelector('#dismiss-dialog')!.addEventListener('click',()=>{dialog.close();dialog.remove();});
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.querySelector('form')!.addEventListener('submit',async e=>{
    e.preventDefault();const button=dialog.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;button.textContent='Looking up live pool…';
    try {const p=await api<Pool>('/api/import',{method:'POST',body:JSON.stringify({address:String(new FormData(e.currentTarget as HTMLFormElement).get('address')).trim()})});dialog.close();view='pools';await load();await selectPool(p.address);toast('Live pool added; detector check queued');}
    catch(error){dialog.querySelector('.dialog-error')!.textContent=(error as Error).message;button.disabled=false;button.textContent='Find pool';}
  });
}
async function load(force=false) {
  try {
    const incoming=await api<Overview>('/api/overview');data=incoming;serverError='';

    if(view==='alerts') {
      const before=alertsBefore,filter=alertsFilter, page=await api<UpdatesPage>(`/api/updates?filter=${filter}${before?`&before=${before}`:''}`);
      if(view==='alerts'&&before===alertsBefore&&filter===alertsFilter)alerts=page;
    }
    if(view==='activity'){const q=activityParams();if(activityBefore)q.set('before',String(activityBefore));activity=await api<ActivityPage>(`/api/activity?${q}`);}
    if(view==='feedback')feedback=await api<FeedbackSummary>('/api/feedback');
    const active=document.activeElement;
    if(view==='settings'&&!document.querySelector('#candle-scheduling')?.contains(active))updateCandlePanel();
    if(!force&&(document.querySelector('form[data-dirty="true"]:not(#research-tags-form):not(#tier-form)') || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || document.querySelector('dialog[open]') || view==='settings'))return;
    if(selected&&reviewViews.includes(view)){let value=await api<Detail>(`/api/pools/${selected}`);if(value.pool.address===selected){
      const primary=value.poolContext?.preferredPool;
      if(!selectedExact&&primary&&primary!==selected){value=await api<Detail>(`/api/pools/${primary}`);selected=primary;chartRange=null;if(chart){chart.remove();chart=null;}view='pools';}
      detail=value;
      if(value.poolContext&&Date.now()-value.poolContext.checkedAt>300_000&&reviewViews.includes(view))await api('/api/pool-context',{method:'POST',body:JSON.stringify({mint:value.pool.mint})});
    }}
    await requestMinuteChart();
    render();
  }catch(error){serverError=(error as Error).message;if(!document.querySelector('dialog[open]'))render();}
}
render();void load();setInterval(()=>void load(),15000);
