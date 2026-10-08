import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DETECTOR, type Candidate, type CandidateRow, type Candle, type Crossing, type Detail, type DetectorSettings,
  type Episode, type Group, type Note, type Pool, type Signal, type SourceHealth, type TokenSecurity, type Tradeability, type AuditEvent, type ActivityPage,
  type ChartFeedback, type FeedbackSummary, type ManualRiskReview, type CapRange, type RangeAlert, type AlertsPage, type UpdatesPage, type MinuteChartState, type SupplyOrigin, type LiquidityProtection, type TokenPoolContext } from '../shared/types.ts';
import { combineRisk, pendingSecurity, pendingTrading, fresh, RISK_POLICY } from './security.ts';
import { capRange, freshReportedCap, rangeMessage } from '../shared/ranges.ts';
import { inScope } from '../shared/scope.ts';
import { assessSupply } from './supply.ts';
import { hardLiquidity, knownLowLiquidity, pendingProtection, LIQUIDITY_POLICY } from './liquidity.ts';
import { RESEARCH_TAGS, shortlisted } from '../shared/research.ts';
import { BASE_VERSION } from '../shared/base.ts';
import { assessBase } from './base-detector.ts';
import type { BaseAssessment } from '../shared/types.ts';
import { screenSnapshots } from './snapshot-screen.ts';
import type { SnapshotPoint, SnapshotScreen, CandleJob, CandleMode } from '../shared/candle-policy.ts';
import { assessDrawdown, DRAWDOWN_POLICY, extremeDrawdown, type ObservedPeak } from '../shared/drawdown.ts';
import { automaticShortlistStage, shortlistStage, manualStageBlock, SHORTLIST_STAGES, type ShortlistStage } from '../shared/shortlist.ts';
import type { StageReview } from '../shared/types.ts';

const parse = <T>(row: any): T => JSON.parse(row.data);
// Legacy first sightings above the range remain in storage/audit, but are not crossing notifications.
export const NOTIFICATION_POLICY = 'consolidation-only-v3';
const notificationWhere = "json_extract(data,'$.policyVersion') = 'consolidation-only-v3'";
export class Store {
  db: DatabaseSync;
  private transactionDepth = 0;
  private peakCache = new Map<string,{at:number;peak:ObservedPeak|null}>();
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pools (address TEXT PRIMARY KEY, mint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pools_mint ON pools(mint);
      CREATE TABLE IF NOT EXISTS candles (pool TEXT NOT NULL, time INTEGER NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(pool,time));
      CREATE TABLE IF NOT EXISTS candles_1m (pool TEXT NOT NULL, time INTEGER NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(pool,time));
      CREATE TABLE IF NOT EXISTS snapshots (pool TEXT NOT NULL, time INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pool,time));
      CREATE TABLE IF NOT EXISTS snapshot_checks (pool TEXT NOT NULL, bucket INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pool,bucket));
      CREATE TABLE IF NOT EXISTS candle_jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candle_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, pool TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS candle_runs_time ON candle_runs(time);
      CREATE TABLE IF NOT EXISTS candidates (mint TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY, pool TEXT NOT NULL, mint TEXT NOT NULL, trigger INTEGER NOT NULL, detected_at INTEGER NOT NULL, data TEXT NOT NULL, original TEXT NOT NULL, UNIQUE(pool,trigger));
      CREATE INDEX IF NOT EXISTS episodes_mint ON episodes(mint);
      CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, mint TEXT NOT NULL, body TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS crossings (id INTEGER PRIMARY KEY, mint TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, observed_at INTEGER NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS health (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (provider TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(provider,minute));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, category TEXT NOT NULL, entity TEXT NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_category_id ON audit(category,id);
      CREATE INDEX IF NOT EXISTS audit_entity_id ON audit(entity,id);
      CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, pool TEXT NOT NULL, episode_id INTEGER, created_at INTEGER NOT NULL, data TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS feedback_pool ON feedback(pool,id);
      CREATE TABLE IF NOT EXISTS stage_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, mint TEXT NOT NULL, pool TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS stage_reviews_mint ON stage_reviews(mint,id);
      CREATE TABLE IF NOT EXISTS chart_ids (id INTEGER PRIMARY KEY AUTOINCREMENT, pool TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, pool TEXT NOT NULL, observed_at INTEGER NOT NULL, data TEXT NOT NULL, read_at INTEGER, UNIQUE(pool,observed_at));
      CREATE INDEX IF NOT EXISTS alerts_unread ON alerts(read_at,id);
      CREATE INDEX IF NOT EXISTS alerts_mint_id ON alerts(mint,id);
      INSERT INTO chart_ids(pool) SELECT address FROM pools WHERE NOT EXISTS (SELECT 1 FROM chart_ids WHERE chart_ids.pool=pools.address) ORDER BY rowid;
      PRAGMA user_version=5;`);
    if (!this.get('audit:initialized', false)) this.transaction(() => {
      this.audit('system', 'audit', 'Audit logging enabled; earlier events are not reconstructed', {
        existingPools: this.db.prepare('SELECT COUNT(*) AS n FROM pools').get()!.n,
        existingEpisodes: this.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,
      });
      this.set('audit:initialized', true);
    });
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    const nested = this.transactionDepth > 0, savepoint = `nested_${this.transactionDepth++}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT'); return value; }
    catch (error) { this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK'); throw error; }
    finally { this.transactionDepth--; }
  }
  get<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT data FROM meta WHERE key=?').get(key); return row ? parse<T>(row) : fallback; }
  set(key: string, value: unknown) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, JSON.stringify(value)); }
  candleJobs(): CandleJob[] { return this.db.prepare('SELECT data FROM candle_jobs').all().map(row=>parse<CandleJob>(row)); }
  saveCandleJob(job:CandleJob) { this.db.prepare('INSERT OR REPLACE INTO candle_jobs VALUES(?,?)').run(job.id,JSON.stringify(job)); }
  snapshotScreen(pool:string): SnapshotScreen | null { return this.get(`snapshotScreen:${pool}`,null); }
  observeSnapshot(pool:Pool,now:number) {
    if(!inScope(pool)||!pool.metricsAt||pool.metricsAt>now||now-pool.metricsAt>120_000)return;
    const point:SnapshotPoint={time:pool.metricsAt,price:pool.price,liquidity:pool.liquidity,volume5m:pool.volume5m,
      buys:pool.buys,sells:pool.sells,source:pool.metricsSource};
    const bucket=Math.floor(pool.metricsAt/300_000);
    const inserted=this.db.prepare('INSERT OR IGNORE INTO snapshot_checks VALUES(?,?,?)').run(pool.address,bucket,JSON.stringify(point));
    if(!inserted.changes)return;
    this.db.prepare('DELETE FROM snapshot_checks WHERE pool=? AND bucket<?').run(pool.address,bucket-7*24*12);
    const points=this.db.prepare('SELECT data FROM snapshot_checks WHERE pool=? ORDER BY bucket').all(pool.address).map(row=>parse<SnapshotPoint>(row));
    this.set(`snapshotScreen:${pool.address}`,screenSnapshots(points,now));
  }
  audit(category: string, entity: string, summary: string, data: unknown = {}, time = Date.now()): number {
    // No credentials, authorization headers, program binaries or unsigned transactions belong in evidence logs.
    const serialized = JSON.stringify(data, (key, value) => /^(authorization|api[-_]?key|secret|private[-_]?key|password|transaction|signedTransaction)$/i.test(key) ? '[redacted]' : value);
    return Number(this.db.prepare('INSERT INTO audit(time,category,entity,summary,data) VALUES(?,?,?,?,?)').run(time,category,entity,summary,serialized).lastInsertRowid);
  }
  activity(category = '', entity = '', before = Number.MAX_SAFE_INTEGER, limit = 100): ActivityPage {
    const where = "WHERE id < ? AND (? = '' OR category = ?) AND (? = '' OR entity = ?)";
    const rows = this.db.prepare(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ?`).all(before,category,category,entity,entity,limit+1) as any[];
    return { events: rows.slice(0,limit).map(row => ({ ...row, data: JSON.parse(row.data) })) as AuditEvent[],
      nextBefore: rows.length > limit ? rows[limit-1].id : null,
      total: Number(this.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE (? = '' OR category = ?) AND (? = '' OR entity = ?)").get(category,category,entity,entity)!.n) };
  }
  *auditExport(category = '', entity = ''): Generator<AuditEvent> {
    const high = Number(this.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit').get()!.n);
    for (const row of this.db.prepare("SELECT * FROM audit WHERE id <= ? AND (? = '' OR category = ?) AND (? = '' OR entity = ?) ORDER BY id").iterate(high,category,category,entity,entity) as Iterable<any>)
      yield { ...row, data: JSON.parse(row.data) };
  }
  feedback(pool: string): ChartFeedback[] {
    return this.db.prepare('SELECT id,data FROM feedback WHERE pool=? ORDER BY id DESC').all(pool).map(row => ({ ...parse<ChartFeedback>(row), id: Number(row.id) }));
  }
  addFeedback(pool: Pool, input: Pick<ChartFeedback, 'formation' | 'base' | 'scope' | 'reason' | 'notes'>, now: number) {
    const episode = this.episodes(pool.mint).filter(e => e.pool === pool.address).at(-1);
    const value = { ...input, mint: pool.mint, pool: pool.address, episodeId: episode?.id ?? null, createdAt: now };
    // Freeze what was available at review time. Original detection remains separate
    // from later base/outcome labels to support chronological evaluation without hindsight leakage.
    const snapshot = { chartCode: this.chartCode(pool.address), pool, base:this.base(pool.address), poolContext:this.poolContext(pool.mint), episode: episode ?? null, settings: this.settings(), risk: this.risk(pool, now),
      research: { manualWatch: this.candidate(pool.mint)?.manualWatch ?? false, tags: this.candidate(pool.mint)?.researchTags ?? [] },
      candles: this.candles(pool.address).filter(c => (c.time + 300) * 1000 <= now).slice(-1000),
      candles1m: this.candles(pool.address,1).filter(c => (c.time + 60) * 1000 <= now).slice(-1000), asOf: now,
      purpose: 'Human review label, not ground truth or an independent return prediction' };
    this.transaction(() => {
      const row = this.db.prepare('INSERT INTO feedback(mint,pool,episode_id,created_at,data,snapshot) VALUES(?,?,?,?,?,?)')
        .run(pool.mint, pool.address, episode?.id ?? null, now, JSON.stringify(value), JSON.stringify(snapshot));
      this.audit('feedback', pool.mint, 'Chart feedback saved with an as-of evidence snapshot', { feedbackId: Number(row.lastInsertRowid), ...value }, now);
      if (this.candidate(pool.mint)) this.patchCandidate(pool.mint, { reviewed: true }, now);
    });
  }
  feedbackSummary(): FeedbackSummary {
    const all = this.db.prepare('SELECT id,data FROM feedback ORDER BY id DESC').all().map(row => ({ ...parse<ChartFeedback>(row), id: Number(row.id) }));
    const latest = [...new Map([...all].reverse().map(f => [`${f.pool}:${f.episodeId ?? 'undetected'}`, f])).values()].sort((a,b)=>b.id-a.id);
    const formationCounts: Record<string,number> = {}, reasonCounts: Record<string,number> = {};
    for (const f of latest) { formationCounts[f.formation] = (formationCounts[f.formation] ?? 0) + 1; reasonCounts[f.reason] = (reasonCounts[f.reason] ?? 0) + 1; }
    const tierReviews={total:Number(this.db.prepare('SELECT COUNT(*) AS n FROM stage_reviews').get()!.n),
      latest:this.db.prepare('SELECT id,data FROM stage_reviews ORDER BY id DESC LIMIT 100').all().map(row=>({...parse<StageReview>(row),id:Number(row.id)}))};
    return { tierReviews,totalReviews: all.length, reviewedCharts: latest.length, latest: latest.slice(0,100), formationCounts, reasonCounts, withoutDetection: latest.filter(f=>f.episodeId===null).length };
  }
  *feedbackExport() {
    const high = Number(this.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM feedback').get()!.n);
    for (const row of this.db.prepare('SELECT id,data,snapshot FROM feedback WHERE id <= ? ORDER BY id').iterate(high) as Iterable<any>)
      yield { ...JSON.parse(row.data), id: row.id, snapshot: JSON.parse(row.snapshot) };
  }
  stageReviews(mint: string, limit=100): StageReview[] {
    return this.db.prepare('SELECT id,data FROM stage_reviews WHERE mint=? ORDER BY id DESC LIMIT ?').all(mint,limit)
      .map(row=>({...parse<StageReview>(row),id:Number(row.id)}));
  }
  *stageReviewExport(mint='') {
    const high=Number(this.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM stage_reviews').get()!.n);
    for(const row of this.db.prepare("SELECT id,data,snapshot FROM stage_reviews WHERE id<=? AND (?='' OR mint=?) ORDER BY id").iterate(high,mint,mint) as Iterable<any>)
      yield {...JSON.parse(row.data),id:row.id,snapshot:JSON.parse(row.snapshot)};
  }
  moveStage(mint:string,stage:ShortlistStage|null,reason:string,requestId:string,now=Date.now()):StageReview {
    if(stage!==null&&(typeof stage!=='string'||!Object.hasOwn(SHORTLIST_STAGES,stage)))throw new Error('Choose a valid shortlist tier or Automatic.');
    if(typeof reason!=='string'||reason.length>15_000)throw new Error('Keep the reason below 15,000 characters.');
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw new Error('A valid move identifier is required.');
    const duplicate=this.db.prepare('SELECT id,data FROM stage_reviews WHERE request_id=?').get(requestId);
    if(duplicate) {
      const saved={...parse<StageReview>(duplicate),id:Number(duplicate.id)};
      if(saved.mint!==mint||saved.toStage!==stage||saved.reason!==reason.trim())throw new Error('This move identifier has already been used.');
      return saved;
    }
    const c=this.candidate(mint),row=c?this.candidateRow(c,now):null;
    if(!c||!row)throw new Error('Candidate not found.');
    const blocked=manualStageBlock(row,now);if(stage!==null&&blocked)throw new Error(blocked);
    const value:Omit<StageReview,'id'>={requestId,mint,pool:c.pool,createdAt:now,fromStage:shortlistStage(row,now),toStage:stage,
      automaticStage:automaticShortlistStage(row,now),previousManualStage:c.manualStage??null,reason:reason.trim(),source:'human',version:'manual-tier-v1'};
    const snapshot={asOf:now,chartCode:row.chartCode,pool:row.poolData,base:row.base,drawdown:row.drawdown,risk:row.risk,
      poolContext:this.poolContext(mint),episodes:this.episodes(mint),settings:this.settings(),drawdownPolicy:DRAWDOWN_POLICY,
      research:{manualWatch:c.manualWatch??false,tags:c.researchTags??[],manualStage:c.manualStage??null},
      candles:this.candles(c.pool).filter(b=>(b.time+300)*1000<=now).slice(-1000),
      candles1m:this.candles(c.pool,1).filter(b=>(b.time+60)*1000<=now).slice(-1000),
      purpose:'Human tier preference and reasoning for signal development; separate from automatic qualification and future outcomes'};
    return this.transaction(()=>{
      const inserted=this.db.prepare('INSERT INTO stage_reviews(request_id,mint,pool,created_at,data,snapshot) VALUES(?,?,?,?,?,?)')
        .run(requestId,mint,c.pool,now,JSON.stringify(value),JSON.stringify(snapshot));
      const id=Number(inserted.lastInsertRowid);
      this.saveCandidate({...c,manualStage:stage?{stage,reason:value.reason,changedAt:now,reviewId:id}:null,reviewed:true,updatedAt:now});
      this.audit('tier-review',mint,stage?`User placed chart in ${SHORTLIST_STAGES[stage].label}`:'User returned chart to automatic tier placement',
        {...value,reviewId:id,automaticTraining:false},now);
      return {...value,id};
    });
  }
  drawdown(pool:Pool,now=Date.now()) {
    let cached=this.peakCache.get(pool.address);
    if(!cached||now<cached.at||now-cached.at>=30_000) {
      const peak=this.db.prepare("SELECT time,CAST(json_extract(data,'$.close') AS REAL) AS price FROM candles WHERE pool=? AND (time+330)*1000<=? AND received_at<=? AND CAST(json_extract(data,'$.close') AS REAL)>0 ORDER BY price DESC,time LIMIT 1").get(pool.address,now,now);
      let observed:ObservedPeak|null=peak?{price:Number(peak.price),at:(Number(peak.time)+300)*1000,source:'Highest recorded five-minute close in this pool'}:null;
      // Existing episode peaks are closing prices too; preserve earlier peak
      // context when only part of the chart history is available.
      for(const e of this.episodes(pool.mint))if(e.pool===pool.address&&e.detectedAt<=now&&e.signal.lastTime*1000<=now
        &&Number.isFinite(e.signal.peak)&&e.signal.peak>0&&(!observed||e.signal.peak>observed.price))
        observed={price:e.signal.peak,at:e.detectedAt,source:'Earlier recorded detector peak close in this pool'};
      if(observed) {
        const closes=this.db.prepare("SELECT (time+300)*1000 AS at,CAST(json_extract(data,'$.close') AS REAL) AS price FROM candles WHERE pool=? AND (time+300)*1000>=? AND (time+330)*1000<=? AND received_at<=? AND CAST(json_extract(data,'$.close') AS REAL)>0 ORDER BY price LIMIT 1").get(pool.address,observed.at,now,now);
        const metrics=this.db.prepare("SELECT time AS at,CAST(json_extract(data,'$.price') AS REAL) AS price FROM snapshots WHERE pool=? AND time>=? AND time<=? AND CAST(json_extract(data,'$.price') AS REAL)>0 ORDER BY price LIMIT 1").get(pool.address,observed.at,now);
        const trough=[closes,metrics].filter(Boolean).sort((a,b)=>Number(a!.price)-Number(b!.price))[0];
        if(trough)observed={...observed,troughPrice:Number(trough.price),troughAt:Number(trough.at)};
      }
      cached={at:now,peak:observed};this.peakCache.set(pool.address,cached);
    }
    return assessDrawdown(pool,cached.peak,now);
  }
  private observeDrawdown(pool:Pool,now:number) {
    if(this.candidate(pool.mint)?.pool!==pool.address)return;
    const current=this.drawdown(pool,now);if(!current)return;
    const previous=this.get<boolean|null>(`drawdownHold:${pool.address}`,null);
    if(previous===current.held)return;
    this.set(`drawdownHold:${pool.address}`,current.held);
    if(current.held||previous!==null)this.audit('drawdown',pool.mint,current.held?'Extreme retracement: automatic shortlist held':'Retracement recovered above the automatic hold threshold',
      {previousHeld:previous,current,manualPlacementAllowed:true,deadTokenClaim:false},now);
  }
  settings(): DetectorSettings { return this.get('detector', DEFAULT_DETECTOR); }
  base(pool: string): BaseAssessment | null { return this.get(`base:${pool}`, null); }
  refreshBase(pool: Pool, now = Date.now()) {
    const previous=this.base(pool.address), current=assessBase(pool,this.candles(pool.address),this.episodes(pool.mint),now);
    // Revisions and newly confirmed pump evidence can change a decision without
    // moving the latest candle timestamp. Ignore only the evaluation clock.
    if(previous&&JSON.stringify({...previous,evaluatedAt:0})===JSON.stringify({...current,evaluatedAt:0}))return;
    this.transaction(()=>{
      this.set(`base:${pool.address}`,current);
      this.audit('base',pool.mint,`Consolidation assessment: ${current.status}`,{pool:pool.address,previous:previous?.status??null,current},now);
      this.observeBaseForMint(pool.mint,now);
    });
  }
  migrateBasePolicy(now=Date.now()) {
    if(this.get<string>('basePolicy','')===BASE_VERSION)return;
    this.transaction(()=>{
      for(const c of this.candidates(now))this.refreshBase(c.poolData,now);
      this.set('basePolicy',BASE_VERSION);
      this.audit('settings','consolidation','Consolidation shortlist enabled; earlier pump detections and notifications retained as background history',
        {version:BASE_VERSION,notificationPolicy:NOTIFICATION_POLICY,automaticTraining:false},now);
    });
  }
  private notify(pool: Pool, message: string, kind: RangeAlert['kind'], now: number) {
    const c=this.candidate(pool.mint);
    if(!c||c.pool!==pool.address||c.archived||c.researchTags?.includes('not_matching')||!inScope(pool)||knownLowLiquidity(pool,now)||!freshReportedCap(pool,now))return;
    const range=capRange(pool.marketCap!);
    const value={mint:pool.mint,pool:pool.address,chartCode:this.chartCode(pool.address),symbol:pool.symbol,name:pool.name,venue:pool.venue,
      from:range,to:range,marketCap:pool.marketCap!,observedAt:now,source:'Consolidation detector',message,kind,policyVersion:NOTIFICATION_POLICY,eligibility:this.group(c,now)};
    const r=this.db.prepare('INSERT OR IGNORE INTO alerts(mint,pool,observed_at,data) VALUES(?,?,?,?)').run(pool.mint,pool.address,now,JSON.stringify(value));
    if(r.changes)this.audit('alert',pool.mint,message,{...value,alertId:Number(r.lastInsertRowid)},now);
  }
  private observeBase(c: CandidateRow, now: number) {
    const base=c.base, valid=shortlisted(c,now)&&(!c.manualStage||c.manualStage.stage==='ready');
    const previous=this.get<{active:boolean;notifiedAt:number;firstAt:number|null;lostNotifiedAt?:number}>(`baseAdmission:${c.pool}`,{active:false,notifiedAt:0,firstAt:null});
    if(c.archived||!inScope(c.poolData)||knownLowLiquidity(c.poolData,now))return;
    if(valid&&base&&freshReportedCap(c.poolData,now)) {
      if(!previous.active) {
        const firstAt=previous.firstAt??now, shouldNotify=now-previous.notifiedAt>=86_400_000;
        this.transaction(()=>{
          this.set(`baseAdmission:${c.pool}`,{...previous,active:true,notifiedAt:shouldNotify?now:previous.notifiedAt,firstAt});
          this.audit('shortlist',c.mint,'Consolidation qualified for review',{pool:c.pool,asOf:now,base,risk:c.risk,price:c.poolData.price,
            marketCap:c.poolData.marketCap,launchProxy:base.launchBasis,backfilled:base.candleEnd!==null&&now-base.candleEnd>600_000},now);
          if(!previous.firstAt)this.set(`baseOutcome:${c.pool}`,{admittedAt:now,price:c.poolData.price,results:{}});
          if(shouldNotify)this.notify(c.poolData,'Consolidation ready for review','base_qualified',now);
        });
      }
    } else if(previous.active&&base&&(base.status!=='qualified'||extremeDrawdown(c.drawdown))&&base.candleEnd&&now-base.candleEnd<=1_800_000) {
      // One loss alert per announced qualification. A silent requalification
      // during the existing cooldown must not generate another loss alert.
      // Read prior alerts once for records written before this field existed.
      const lostAt=previous.lostNotifiedAt??Number(this.db.prepare(`SELECT MAX(observed_at) AS time FROM alerts WHERE pool=? AND ${notificationWhere} AND json_extract(data,'$.kind')='base_lost'`).get(c.pool)!.time??0);
      const shouldNotify=previous.notifiedAt>lostAt;
      this.transaction(()=>{
        this.set(`baseAdmission:${c.pool}`,{...previous,active:false,lostNotifiedAt:shouldNotify?now:lostAt});
        this.audit('shortlist',c.mint,'Consolidation no longer meets the range criteria',{pool:c.pool,base,notification:shouldNotify?'sent':'existing change already notified'},now);
        if(shouldNotify)this.notify(c.poolData,'Consolidation changed · review the range','base_lost',now);
      });
    }
  }
  // Admission reacts to the last piece of evidence arriving. The periodic sweep
  // remains for expiry and recovery, not as an extra waiting period.
  private observeBaseForMint(mint: string, now: number) {
    const candidate=this.candidate(mint), row=candidate?this.candidateRow(candidate,now):null;
    if(row)this.observeBase(row,now);
  }
  private observeOutcome(pool: Pool, now: number) {
    const saved=this.get<{admittedAt:number;price:number;results:Record<string,unknown>}|null>(`baseOutcome:${pool.address}`,null);
    if(!saved||!saved.price||!pool.price||!freshReportedCap(pool,now))return;
    for(const hours of [6,24,72,168])if(now-saved.admittedAt>=hours*3_600_000&&!saved.results[hours]) {
      const observation={hours,observedAt:now,delayHours:(now-saved.admittedAt)/3_600_000-hours,price:pool.price,
        priceChangePercent:(pool.price/saved.price-1)*100,liquidity:pool.liquidity,source:pool.metricsSource};
      saved.results[hours]=observation;
      this.audit('outcome',pool.mint,'First available price observation after review qualification',{pool:pool.address,admittedAt:saved.admittedAt,...observation},now);
    }
    this.set(`baseOutcome:${pool.address}`,saved);
  }
  chartCode(pool: string): string {
    const row = this.db.prepare('SELECT id FROM chart_ids WHERE pool=?').get(pool);
    if (!row) throw new Error('Chart identity is missing');
    return `CH-${String(row.id).padStart(6,'0')}`;
  }
  unreadAlerts(): number { return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL AND ${notificationWhere}`).get()!.n); }
  unreadUpdateCoins(): number { return Number(this.db.prepare(`SELECT COUNT(DISTINCT mint) AS n FROM alerts WHERE read_at IS NULL AND ${notificationWhere}`).get()!.n); }
  private alertRow(row:any):RangeAlert {
    const alert=JSON.parse(row.data),pool=this.pool(row.pool),matching=pool?.mint===row.mint?pool:null;
    return {...alert,name:alert.name||matching?.name||'',symbol:alert.symbol||matching?.symbol||'',venue:alert.venue??matching?.venue,
      id:row.id,code:`AL-${String(row.id).padStart(6,'0')}`,readAt:row.read_at};
  }
  updates(before=Number.MAX_SAFE_INTEGER,limit=50,unreadOnly=false):UpdatesPage {
    // Page by each mint's latest event globally, not by event pages: a coin's
    // earlier alerts must never make it appear again on the next page.
    const rows=this.db.prepare(`SELECT mint,MAX(id) AS latest,COUNT(*) AS total,SUM(read_at IS NULL) AS unread FROM alerts WHERE ${notificationWhere}
      GROUP BY mint HAVING MAX(id) < ? AND (?=0 OR SUM(read_at IS NULL)>0) ORDER BY latest DESC LIMIT ?`).all(before,Number(unreadOnly),limit+1) as any[];
    return {threads:rows.slice(0,limit).map(row=>({
      latest:this.alertRow(this.db.prepare('SELECT * FROM alerts WHERE id=?').get(row.latest)),
      history:(this.db.prepare(`SELECT * FROM alerts WHERE mint=? AND id<? AND ${notificationWhere} ORDER BY id DESC LIMIT 20`).all(row.mint,row.latest) as any[]).map(r=>this.alertRow(r)),
      totalEvents:row.total,unreadCount:row.unread,
    })),unread:this.unreadUpdateCoins(),nextBefore:rows.length>limit?rows[limit-1].latest:null};
  }
  markCoinAlertsRead(mint:string,through:number,now=Date.now()) {
    this.transaction(()=>{
      const changed=this.db.prepare(`UPDATE alerts SET read_at=? WHERE mint=? AND id<=? AND read_at IS NULL AND ${notificationWhere}`).run(now,mint,through).changes;
      if(changed)this.audit('review',mint,'Coin updates marked read',{through,count:Number(changed)},now);
    });
  }
  alerts(before = Number.MAX_SAFE_INTEGER, limit = 50, unreadOnly = false): AlertsPage {
    const rows = this.db.prepare(`SELECT * FROM alerts WHERE id < ? AND ${notificationWhere} ${unreadOnly?'AND read_at IS NULL':''} ORDER BY id DESC LIMIT ?`).all(before,limit+1) as any[];
    return { alerts: rows.slice(0,limit).map(row => {
      const alert=JSON.parse(row.data), pool=this.pool(row.pool), matching=pool?.mint===row.mint?pool:null;
      // Older alerts did not store names. Resolve only their exact pool/mint, without rewriting history.
      return { ...alert, name:alert.name||matching?.name||'', symbol:alert.symbol||matching?.symbol||'', venue:alert.venue??matching?.venue,
        id: row.id, code: `AL-${String(row.id).padStart(6,'0')}`, readAt: row.read_at };
    }) as RangeAlert[],
      unread: this.unreadAlerts(), nextBefore: rows.length > limit ? rows[limit-1].id : null };
  }
  markAlertsRead(through: number, now: number, single = false) {
    this.transaction(() => {
      const changed = this.db.prepare(`UPDATE alerts SET read_at=? WHERE id${single?'=':'<='}? AND read_at IS NULL`).run(now,through).changes;
      if (changed) this.audit('review','alerts','Range alerts marked read',{ through, single, count: Number(changed) },now);
    });
  }
  pool(address: string): Pool | null { const row = this.db.prepare('SELECT data FROM pools WHERE address=?').get(address); return row ? parse<Pool>(row) : null; }
  pools(): Pool[] { return this.db.prepare("SELECT data FROM pools ORDER BY json_extract(data,'$.observedAt') DESC").all().map(row => parse<Pool>(row)); }
  savePool(pool: Pool) {
    this.db.prepare('INSERT OR REPLACE INTO pools VALUES(?,?,?)').run(pool.address, pool.mint, JSON.stringify(pool));
    if (!this.db.prepare('SELECT id FROM chart_ids WHERE pool=?').get(pool.address)) this.db.prepare('INSERT OR IGNORE INTO chart_ids(pool) VALUES(?)').run(pool.address);
  }
  discover(incoming: Pool): boolean {
    const old = this.pool(incoming.address);
    if (old) {
      this.savePool({ ...old, symbol: incoming.symbol || old.symbol, name: incoming.name || old.name,
        origin: old.origin === 'Unknown' ? incoming.origin : old.origin,
        evidence: old.evidence || incoming.evidence, createdAt: old.createdAt ?? incoming.createdAt });
      return false;
    }
    this.transaction(() => { this.savePool(incoming); this.audit('discovery', incoming.mint, `Discovered ${incoming.venue} pool`, incoming, incoming.observedAt); }); return true;
  }
  candidate(mint: string): Candidate | null { const row = this.db.prepare('SELECT data FROM candidates WHERE mint=?').get(mint); return row ? parse<Candidate>(row) : null; }
  saveCandidate(candidate: Candidate) { this.db.prepare('INSERT OR REPLACE INTO candidates VALUES(?,?)').run(candidate.mint, JSON.stringify(candidate)); }
  security(mint: string): TokenSecurity { return this.get(`security:${mint}`, pendingSecurity(mint)); }
  saveSecurity(check: TokenSecurity) { this.transaction(() => { this.set(`security:${check.mint}`, check); this.audit('controls', check.mint, `Token controls: ${check.status}`, check); this.observeBaseForMint(check.mint,check.checkedAt??Date.now()); }); }
  trading(pool: Pool): Tradeability { return this.get(`trading:${pool.address}`, pendingTrading(pool)); }
  saveTrading(check: Tradeability) { this.transaction(() => { this.set(`trading:${check.pool}`, check); this.audit('trading', check.mint, `Trading checks: ${check.status}`, check); this.observeBaseForMint(check.mint,check.checkedAt??Date.now()); }); }
  supplyOrigin(mint: string): SupplyOrigin | null { return this.get(`supplyOrigin:${mint}`,null); }
  poolContext(mint:string): TokenPoolContext|null { return this.get(`poolContext:${mint}`,null); }
  savePoolContext(context:TokenPoolContext) { this.transaction(()=>{const previous=this.poolContext(context.mint);this.set(`poolContext:${context.mint}`,context);this.audit('pool-context',context.mint,'Same-mint pools compared; Meteora retained as context',{previous,current:context},context.checkedAt);}); }
  saveSupplyOrigin(origin: SupplyOrigin) { this.transaction(()=>{this.set(`supplyOrigin:${origin.mint}`,origin);this.audit('supply',origin.mint,'Initial token issuance verified',origin,origin.checkedAt);this.observeBaseForMint(origin.mint,origin.checkedAt);}); }
  supply(mint: string, now = Date.now()) { return assessSupply(this.security(mint),this.supplyOrigin(mint),now,this.get<{issue?:string}|null>(`supplySearch:${mint}`,null)?.issue); }
  protection(pool: Pool, now=Date.now()): LiquidityProtection {
    const value=this.get<LiquidityProtection>(`protection:${pool.address}`,pendingProtection(pool));
    if(value.pool!==pool.address||value.mint!==pool.mint||value.policyVersion!==LIQUIDITY_POLICY.version)return pendingProtection(pool);
    return value.status==='passed'&&!fresh(value.checkedAt,now,LIQUIDITY_POLICY.maxAge)?{...value,status:'pending',reasons:['Liquidity lock/burn evidence has expired; recheck required',...value.reasons]}:value;
  }
  saveProtection(value: LiquidityProtection) { this.transaction(()=>{this.set(`protection:${value.pool}`,value);this.audit('liquidity',value.mint,`Pool liquidity protection: ${value.status}`,value);this.observeBaseForMint(value.mint,value.checkedAt??Date.now());}); }
  risk(pool: Pool, now = Date.now()) {
    const risk=combineRisk(pool,this.security(pool.mint),this.trading(pool),now), supply=this.supply(pool.mint,now), floor=hardLiquidity(pool,now), liquidityProtection=this.protection(pool,now);
    const checks=[risk,supply,floor,liquidityProtection], status: typeof risk.status=checks.some(c=>c.status==='excluded')?'excluded':checks.some(c=>c.status==='pending')?'pending':'passed';
    return { ...risk,status,reasons:[...floor.reasons,...(supply.status==='passed'?[]:supply.reasons),...(liquidityProtection.status==='passed'?[]:liquidityProtection.reasons),...risk.reasons],supply,liquidityProtection,manualReview:this.get<ManualRiskReview|null>(`manualRisk:${pool.mint}`,null) };
  }
  manualRiskReview(mint: string, approved: boolean, notes: string, now: number) {
    if (!this.candidate(mint)) throw new Error('A detected candidate is required for manual inclusion');
    const review: ManualRiskReview = { mint, approved, notes, createdAt: now, scope: 'trading-screen' };
    this.transaction(() => {
      this.set(`manualRisk:${mint}`, review);
      this.audit('review', mint, approved ? 'User manually included this coin; automatic trading warnings remain visible' : 'User removed manual trading-screen inclusion', review, now);
      if (approved) this.patchCandidate(mint, { reviewed: true }, now);
      this.observeBaseForMint(mint,now);
    });
  }
  group(c: Candidate, now = Date.now()): Group {
    if (c.archived || c.researchTags?.includes('not_matching')) return 'archived';
    const pool = this.pool(c.pool), risk = pool ? this.risk(pool, now) : null;
    if (pool && !inScope(pool)) return 'parked';
    const controlsCurrent = risk?.controls.status === 'passed' && risk.controls.policyVersion === RISK_POLICY.version
      && fresh(risk.controls.checkedAt, now, RISK_POLICY.controlsMaxAge);
    if (risk?.manualReview?.approved && controlsCurrent && pool) {
      const mandatory=[risk.supply!,risk.liquidityProtection!,hardLiquidity(pool,now)];
      if(mandatory.some(check=>check.status==='excluded'))return 'excluded';
      if(mandatory.some(check=>check.status!=='passed'))return 'pending';
      return c.capRange === 'above' ? 'above' : c.below === true ? 'below' : 'watching';
    }
    if (risk?.status === 'excluded') return 'excluded';
    if (risk?.status !== 'passed') return 'pending';
    return c.capRange === 'above' ? 'above' : c.below === true ? 'below' : c.reviewed ? 'watching' : 'new';
  }
  observeGroups(now = Date.now()) {
    for (const c of this.candidates(now)) {
      this.observeBase(c,now);
      const observed = { group: c.group, risk: c.risk.status, reasons: c.risk.reasons, manualInclusion: c.risk.manualReview?.approved ?? false };
      const previous = this.get<unknown>(`lastGroup:${c.mint}`, null);
      if (JSON.stringify(observed) !== JSON.stringify(previous)) this.transaction(() => {
        this.set(`lastGroup:${c.mint}`, observed);
        this.audit('grouping', c.mint, `Observed watchlist group: ${c.group}`, { previous, current: observed, pool: c.pool }, now);
      });
    }
  }
  episodes(mint: string): Episode[] {
    return this.db.prepare('SELECT * FROM episodes WHERE mint=? ORDER BY trigger').all(mint).map((row: any) => ({
      id: Number(row.id), mint, pool: row.pool, detectedAt: Number(row.detected_at), signal: parse<Signal>(row), original: JSON.parse(row.original),
    }));
  }
  recordSignals(pool: Pool, signals: Signal[], now: number) {
    this.peakCache.delete(pool.address);
    this.transaction(() => {
      for (const signal of signals) {
        const existing = this.db.prepare('SELECT id,data FROM episodes WHERE pool=? AND trigger=?').get(pool.address, signal.trigger);
        if (existing) {
          const old = parse<Signal>(existing);
          // Never revoke previously supported volume when settings or vendor candles change.
          const updated = { ...signal, volumeQualified: old.volumeQualified || signal.volumeQualified,
            volumeRatio: old.volumeQualified ? old.volumeRatio : signal.volumeRatio,
            volumeConfirmedAt: old.volumeConfirmedAt ?? signal.volumeConfirmedAt };
          this.db.prepare('UPDATE episodes SET data=? WHERE id=?').run(JSON.stringify(updated), existing.id);
          if (JSON.stringify(old) !== JSON.stringify(updated)) this.audit('detector', pool.mint, 'Formation evidence updated', { pool: pool.address, episode: existing.id, signal: updated }, now);
        }
        else {
          const inserted = this.db.prepare('INSERT INTO episodes(pool,mint,trigger,detected_at,data,original) VALUES(?,?,?,?,?,?)')
            .run(pool.address, pool.mint, signal.trigger, now, JSON.stringify(signal), JSON.stringify(signal));
          this.audit('detector', pool.mint, signal.volumeQualified ? 'Initial pump and volume detected' : 'Initial price formation detected; volume provisional', { pool: pool.address, episode: Number(inserted.lastInsertRowid), signal, risk: this.risk(pool, now) }, now);
        }
        if (!this.candidate(pool.mint)) this.saveCandidate({ mint: pool.mint, pool: pool.address,
          qualifiedAt: now, reviewed: false, pinned: false, archived: false, below: null, lastCapAt: null, label: '', updatedAt: now });
      }
      const candidate=this.candidate(pool.mint), previousPool=candidate?this.pool(candidate.pool):null;
      const preferred=this.poolContext(pool.mint)?.preferredPool;
      if(signals.length && candidate && previousPool && candidate.pool!==pool.address && (!inScope(previousPool)||preferred===pool.address) && inScope(pool) && !knownLowLiquidity(pool,now)) {
        this.saveCandidate({...candidate,pool:pool.address,below:null,capRange:'unknown',lastCapAt:null,lastMarketCap:null,updatedAt:now});
        this.audit('grouping',pool.mint,'Tracked pool changed to an in-scope pool with its own detected formation',{previousPool:previousPool.address,currentPool:pool.address,previousChartCode:this.chartCode(previousPool.address),chartCode:this.chartCode(pool.address),historyRetained:true},now);
      }
      if (signals.length) this.classify(pool, now);
      this.observeDrawdown(pool,now);
      if(this.candidate(pool.mint))this.refreshBase(pool,now);
      this.audit('screening', pool.mint, signals.length ? `${signals.length} formation episodes evaluated` : 'Chart evaluated; no initial formation matched', { pool: pool.address, settings: this.settings(), candleCount: this.candles(pool.address).length }, now);
    });
  }
  updateMetrics(pool: Pool, now: number) {
    this.peakCache.delete(pool.address);
    this.transaction(() => {
      const previousPool=this.pool(pool.address), wasLow=previousPool?knownLowLiquidity(previousPool,now):false, isLow=knownLowLiquidity(pool,now);
      this.savePool(pool);
      if(isLow!==wasLow)this.audit('liquidity',pool.mint,isLow?'Pool disregarded below $1,000 liquidity':'Reported liquidity recovered above the hard floor; other checks still apply',
        {pool:pool.address,chartCode:this.chartCode(pool.address),previousLiquidity:previousPool?.liquidity??null,liquidity:pool.liquidity,metricsAt:pool.metricsAt,source:pool.metricsSource,decision:isLow?'ignored':'recheck',notInferred:'Cause of liquidity change or malicious intent'},now);
      const observation = {
        price: pool.price, marketCap: pool.marketCap, fdv: pool.fdv, capBasis: pool.capBasis, liquidity: pool.liquidity,
        volume5m: pool.volume5m, volume30m: pool.volume30m, volume1h: pool.volume1h,
        buys: pool.buys, sells: pool.sells, source: pool.metricsSource, sourceAsOf: pool.sourceAsOf,
      };
      const serialized = JSON.stringify(observation);
      const previous = this.db.prepare('SELECT time,data FROM snapshots WHERE pool=? ORDER BY time DESC LIMIT 1').get(pool.address);
      const changed = previous?.data !== serialized;
      if (changed) this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)').run(pool.address, now, serialized);
      if(this.get<CandleMode>('candleSchedulerMode','legacy')==='priority')this.observeSnapshot(pool,now);
      this.classify(pool, now);
      this.observeDrawdown(pool,now);
      this.observeBaseForMint(pool.mint,now);
      this.observeOutcome(pool,now);
      this.audit('metrics', pool.mint, changed ? 'Pool activity changed' : 'Pool activity checked; unchanged', {
        pool: pool.address, snapshotAt: changed ? now : Number(previous!.time), metricsAt: pool.metricsAt,
        screen: pool.screen, ...(changed ? { observation } : {}),
      }, now);
    });
  }
  private classify(pool: Pool, now: number) {
    const c = this.candidate(pool.mint);
    if (!c || c.pool !== pool.address || !inScope(pool)) return;
    if (!freshReportedCap(pool, now) || (c.lastCapAt !== null && pool.metricsAt! <= c.lastCapAt)) return;
    // Numeric range and volume/base judgments are separate. Provisional stays provisional.
    const previous: CapRange = c.capRange ?? (c.below === true ? 'below' : 'unknown');
    const next = capRange(pool.marketCap!);
    const updated = { ...c, capRange: next, below: next === 'below', lastMarketCap: pool.marketCap, lastCapAt: pool.metricsAt, updatedAt: now };
    this.saveCandidate(updated);
    if (previous !== next) {
      const message = rangeMessage(previous, next), chartCode = this.chartCode(pool.address);
      const change = { chartCode, pool: pool.address, from: previous, to: next, marketCap: pool.marketCap!, source: pool.metricsSource, observedAt: pool.metricsAt! };
      this.audit('grouping', c.mint, message, change, pool.metricsAt!);
      // First sightings above the band are background discoveries, not crossings from the target range.
      // Keep the detector and grouping evidence; a later actual crossing will still notify.
      if (previous === 'unknown' && (next === 'within'||next==='above')) return;
      this.db.prepare('INSERT INTO crossings(mint,kind,value,observed_at,source) VALUES(?,?,?,?,?)')
        .run(c.mint, message, pool.marketCap!, pool.metricsAt!, pool.metricsSource);
      const followed=c.manualWatch===true||!!this.get<{firstAt:number|null}|null>(`baseAdmission:${pool.address}`,null)?.firstAt;
      if (followed && previous!=='unknown' && !c.archived && !c.researchTags?.includes('not_matching') && !knownLowLiquidity(pool,now)) {
        const alert = { ...change, mint: c.mint, symbol: pool.symbol, name:pool.name, venue:pool.venue, message, eligibility: this.group(updated, now),kind:'range',policyVersion:NOTIFICATION_POLICY };
        const result = this.db.prepare('INSERT OR IGNORE INTO alerts(mint,pool,observed_at,data) VALUES(?,?,?,?)').run(c.mint,pool.address,pool.metricsAt!,JSON.stringify(alert));
        if (result.changes) this.audit('alert',c.mint,message,{ ...alert, alertId: Number(result.lastInsertRowid) },pool.metricsAt!);
      }
    }
  }
  private candidateRow(c: Candidate, now: number): CandidateRow | null {
      const poolData = this.pool(c.pool), episodes = this.episodes(c.mint);
      if (!poolData || !episodes.length) return null;
      const notesCount = Number(this.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE mint=?').get(c.mint)!.n);
      const episode = episodes.filter(e => e.pool === c.pool).at(-1) ?? episodes.at(-1)!;
      return { ...c, drawdown:this.drawdown(poolData,now),base:this.base(c.pool),shortlistedAt:this.get<{firstAt:number|null}|null>(`baseAdmission:${c.pool}`,null)?.firstAt??null, chartCode: this.chartCode(c.pool), capRange: c.capRange ?? (c.below === true ? 'below' : 'unknown'),
        group: this.group(c, now), poolData, episode, episodesCount: episodes.length, notesCount, risk: this.risk(poolData, now) };
  }
  candidates(now = Date.now()): CandidateRow[] {
    return this.db.prepare('SELECT data FROM candidates').all().flatMap(row => {
      const candidate=this.candidateRow(parse<Candidate>(row),now);
      return candidate?[candidate]:[];
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.qualifiedAt - a.qualifiedAt);
  }
  migrateResearchArchivePolicy(now=Date.now()) {
    if(this.get<string>('researchArchivePolicy','')==='not-my-setup-archives-v1')return;
    this.transaction(()=>{
      let archived=0;
      for(const row of this.db.prepare('SELECT data FROM candidates').all()) {
        const c=parse<Candidate>(row);
        if(c.researchTags?.includes('not_matching')&&(!c.archived||c.manualWatch)) {
          this.patchCandidate(c.mint,{researchTags:c.researchTags},now,'policy');archived++;
        }
      }
      this.set('researchArchivePolicy','not-my-setup-archives-v1');
      this.audit('settings','research-tags','Not my setup now archives coins; existing user labels applied',{archived,historyRetained:true},now);
    });
  }
  patchCandidate(mint: string, patch: Partial<Pick<Candidate, 'pinned' | 'archived' | 'reviewed' | 'label' | 'manualWatch' | 'researchTags'>>, now: number, actor: 'human'|'policy'='human') {
    const c = this.candidate(mint); if (!c) throw new Error('Candidate not found');
    if ('manualWatch' in patch && typeof patch.manualWatch !== 'boolean') throw new Error('Choose whether to add this coin to your selections');
    if ('researchTags' in patch && (!Array.isArray(patch.researchTags) || patch.researchTags.length > Object.keys(RESEARCH_TAGS).length
      || patch.researchTags.some(tag => !Object.hasOwn(RESEARCH_TAGS, tag)) || new Set(patch.researchTags).size !== patch.researchTags.length)) throw new Error('Choose valid research tags');
    const pool = this.pool(c.pool)!;
    const changes={...patch};
    // Explicit restoration reverses the rejection, retaining other research tags and the earlier audit.
    if(changes.archived===false&&!('researchTags' in changes)&&c.researchTags?.includes('not_matching'))changes.researchTags=c.researchTags.filter(tag=>tag!=='not_matching');
    const notMySetup=(changes.researchTags??c.researchTags)?.includes('not_matching');
    if(notMySetup){changes.archived=true;changes.manualWatch=false;}
    if (changes.manualWatch && (!inScope(pool) || knownLowLiquidity(pool, now) || (changes.archived??c.archived))) throw new Error('Restore an in-scope coin with at least $1,000 pool liquidity before adding it to your selections');
    const updated={...c,...changes,updatedAt:now};
    this.transaction(() => {
      this.saveCandidate(updated);
      if ('manualWatch' in changes || 'researchTags' in changes) {
        this.audit('review', mint, actor==='policy'?'Existing Not my setup label applied; coin archived':notMySetup?'Not my setup preference applied; coin archived and removed from research watchlist':'User changed research watchlist or tags; screening checks unchanged', {
          actor, previous: { archived:c.archived, manualWatch: c.manualWatch ?? false, tags: c.researchTags ?? [] },
          current: { archived:updated.archived, manualWatch: updated.manualWatch ?? false, tags: updated.researchTags ?? [] },
          snapshot: { pool, base:this.base(pool.address), capRange: c.capRange ?? 'unknown', lastCapAt: c.lastCapAt, risk: this.risk(pool, now),
            episodes: this.episodes(mint), settings: this.settings(),
            candles: this.candles(pool.address).filter(bar => (bar.time + 300) * 1000 <= now).slice(-1000), asOf: now },
          purpose: 'Human research preference, not verification of safety or confirmation of a base',
        }, now);
      } else this.audit('review', mint, 'Manual candidate action', changes, now);
      this.observeBaseForMint(mint,now);
    });
  }
  addNote(mint: string, body: string, label: string, now: number) {
    if (!this.candidate(mint)) throw new Error('Candidate not found');
    this.transaction(() => {
      this.db.prepare('INSERT INTO notes(mint,body,label,created_at) VALUES(?,?,?,?)').run(mint, body, label, now);
      this.patchCandidate(mint, { reviewed: true, label }, now);
      this.audit('review', mint, 'Review note saved', { body, label }, now);
    });
  }
  saveCandles(pool: string, candles: Candle[], source: string, now: number, minutes: 1 | 5 = 5) {
    if(minutes===5)this.peakCache.delete(pool);
    const table = minutes === 1 ? 'candles_1m' : 'candles';
    const statement = this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?,?,?,?)`);
    this.transaction(() => {
      const existing = new Map(this.candles(pool,minutes).map(c => [c.time, c]));
      const added: Candle[] = [], corrected: { previous: Candle; current: Candle }[] = [];
      for (const c of candles) {
        const old = existing.get(c.time);
        if (old && JSON.stringify(old) === JSON.stringify(c)) continue;
        statement.run(pool, c.time, JSON.stringify(c), source, now);
        if (old) corrected.push({ previous: old, current: c }); else added.push(c);
      }
      this.audit('candles', this.pool(pool)?.mint ?? pool, `${added.length} new ${minutes}m candles; ${corrected.length} revisions`, { pool, source, minutes, receivedCount: candles.length, added, corrected }, now);
    });
  }
  candles(pool: string, minutes: 1 | 5 = 5): Candle[] { return this.db.prepare(`SELECT data FROM ${minutes===1?'candles_1m':'candles'} WHERE pool=? ORDER BY time`).all(pool).map(row => parse<Candle>(row)); }
  minuteChart(pool: string): MinuteChartState { return this.get(`minuteChart:${pool}`, { checkedAt: null, lastAttempt: null, issue: null }); }
  detail(address: string): Detail | null {
    const pool = this.pool(address); if (!pool) return null;
    const supplySearch=this.get<{pages:number;nextAt:number;probes:string[];exhausted:boolean;lastAttempt?:number;issue:string}|null>(`supplySearch:${pool.mint}`,null);
    return { stageReviews:this.stageReviews(pool.mint),base:this.base(address), chartCode: this.chartCode(address), row: this.candidates().find(c => c.mint === pool.mint) ?? null, pool, candles: this.candles(address),
      launchOrigin:this.get(`launchOrigin:${pool.mint}`,null),checksRequestedAt:this.get<number|null>(`checkRefresh:${address}`,null),
      supplySearch:supplySearch?{pages:supplySearch.pages,nextAt:supplySearch.nextAt,remaining:supplySearch.probes.length,
        exhausted:supplySearch.exhausted,lastAttempt:supplySearch.lastAttempt??null,issue:supplySearch.issue}:null,
      candles1m: this.candles(address,1), minuteChart: this.minuteChart(address),
      minuteSource: (this.db.prepare('SELECT source FROM candles_1m WHERE pool=? ORDER BY time DESC LIMIT 1').get(address)?.source as string) ?? null,
      episodes: this.episodes(pool.mint), notes: this.db.prepare('SELECT id,mint,body,label,created_at AS createdAt FROM notes WHERE mint=? ORDER BY created_at DESC').all(pool.mint) as unknown as Note[],
      crossings: this.db.prepare('SELECT id,mint,kind,value,observed_at AS observedAt,source FROM crossings WHERE mint=? ORDER BY observed_at DESC').all(pool.mint) as unknown as Crossing[],
      pools: this.db.prepare('SELECT data FROM pools WHERE mint=?').all(pool.mint).map(row => parse<Pool>(row)),
      candleSource: (this.db.prepare('SELECT source FROM candles WHERE pool=? ORDER BY time DESC LIMIT 1').get(address)?.source as string) ?? null,
      risk: this.risk(pool), feedback: this.feedback(pool.address), poolContext:this.poolContext(pool.mint), asOf: Date.now() };
  }
  health(): SourceHealth[] { return this.db.prepare('SELECT data FROM health').all().map(row => parse<SourceHealth>(row)); }
  setHealth(id: string, name: string, patch: Partial<SourceHealth>) {
    const previous = this.health().find(h => h.id === id) ?? { id, name, state: 'idle', detail: 'Waiting for first check', lastSuccess: null, lastAttempt: null, requests: 0, errors: 0, nextAt: 0 };
    this.db.prepare('INSERT OR REPLACE INTO health VALUES(?,?)').run(id, JSON.stringify({ ...previous, ...patch, name }));
    if (patch.state && patch.state !== previous.state || patch.detail && patch.detail !== previous.detail)
      this.audit('source', id, patch.detail ?? `Source state: ${patch.state}`, { state: patch.state ?? previous.state, previousState: previous.state, nextAt: patch.nextAt ?? previous.nextAt });
  }
  countRequests(provider: string, since: number): number { return Number(this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM requests WHERE provider=? AND minute>=?').get(provider, Math.floor(since / 60_000))!.n); }
  request(provider: string, now: number) {
    this.db.prepare('INSERT INTO requests VALUES(?,?,1) ON CONFLICT(provider,minute) DO UPDATE SET count=count+1').run(provider, Math.floor(now / 60_000));
  }
  requestsToday(): number { return Number(this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM requests WHERE minute>=?').get(Math.floor(Date.now() / 86_400_000) * 1440)!.n); }
  storageBytes(): number { return Number(this.db.prepare('PRAGMA page_count').get()!.page_count) * Number(this.db.prepare('PRAGMA page_size').get()!.page_size); }
}
