import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { alertCoinLabel } from '../shared/alerts.ts';
import { belowCapTone } from '../shared/ranges.ts';

const now=1_790_520_000_000;
function setup() {
  const store=new Store(':memory:');
  const pool={...blankPool('Pool','ExactMint','PumpSwap',now),name:'Example Coin',symbol:'EX',liquidity:20_000,marketCap:60_000,metricsAt:now,capBasis:'provider_reported' as const};
  store.discover(pool);
  store.saveCandidate({mint:pool.mint,pool:pool.address,qualifiedAt:now,reviewed:false,pinned:false,archived:false,manualWatch:true,below:false,capRange:'within',lastCapAt:now,label:'',updatedAt:now});
  const move=(cap:number,time:number)=>store.updateMetrics({...store.pool(pool.address)!,marketCap:cap,metricsAt:time},time);
  return {store,pool,move};
}

test('notifications retain the coin name, symbol and exact pool identity captured at the event',()=>{
  const {store,pool,move}=setup();
  try {
    move(270_000,now+1000);const first=store.alerts().alerts[0];
    assert.equal(alertCoinLabel(first),'Example Coin (EX)');assert.equal(first.venue,'PumpSwap');
    assert.equal(first.pool,pool.address);assert.equal(first.mint,pool.mint);
    store.savePool({...store.pool(pool.address)!,name:'Renamed Coin',symbol:'NEW'});
    assert.equal(alertCoinLabel(store.alerts().alerts[0]),'Example Coin (EX)');
    assert.equal(store.alerts().alerts[0].chartCode,first.chartCode);
  } finally {store.close();}
});

test('old alerts resolve missing names only from the same pool and mint without modifying stored history',()=>{
  const {store,pool,move}=setup();
  try {
    move(270_000,now+1000);const row=store.db.prepare('SELECT id,data FROM alerts').get()!;
    const old=JSON.parse(String(row.data));delete old.name;delete old.venue;old.symbol='';
    const original=JSON.stringify(old);store.db.prepare('UPDATE alerts SET data=? WHERE id=?').run(original,row.id!);
    assert.equal(alertCoinLabel(store.alerts().alerts[0]),'Example Coin (EX)');
    assert.equal(store.db.prepare('SELECT data FROM alerts WHERE id=?').get(row.id!)!.data,original);
    store.savePool({...pool,mint:'DifferentMint',name:'Wrong Coin',symbol:'WRONG'});
    const mismatched=store.alerts().alerts[0];assert.equal(mismatched.name,'');assert.equal(mismatched.symbol,'');
    assert.equal(mismatched.mint,'ExactMint');
  } finally {store.close();}
});

test('unread pagination finds older coins after the newest is read and bulk read leaves later arrivals unread',()=>{
  const {store,move}=setup();
  try {
    [270_000,60_000,25_000,60_000,270_000].forEach((cap,i)=>move(cap,now+(i+1)*1000));
    const all=store.alerts().alerts, newest=all[0];store.markAlertsRead(newest.id,now+6000,true);
    const first=store.alerts(Number.MAX_SAFE_INTEGER,2,true);
    assert.equal(first.unread,4);assert.deepEqual(first.alerts.map(a=>a.id),all.slice(1,3).map(a=>a.id));
    assert.equal(store.alerts(Number.MAX_SAFE_INTEGER,1,true).alerts[0].id,all[1].id);
    const older=store.alerts(first.nextBefore!,2,true);
    assert.deepEqual(older.alerts.map(a=>a.id),all.slice(3).map(a=>a.id));assert.equal(older.nextBefore,null);
    move(60_000,now+7000);store.markAlertsRead(newest.id,now+8000);
    assert.equal(store.unreadAlerts(),1);assert.equal(store.alerts(Number.MAX_SAFE_INTEGER,50,true).alerts[0].id,newest.id+1);
    assert.equal(store.alerts().alerts.length,6);
  } finally {store.close();}
});

test('coin labels remain useful with only a name, symbol or address and avoid duplicate names',()=>{
  assert.equal(alertCoinLabel({mint:'123456789',name:' Coin ',symbol:'COIN'}),'Coin');
  assert.equal(alertCoinLabel({mint:'123456789',name:'Coin',symbol:''}),'Coin');
  assert.equal(alertCoinLabel({mint:'123456789',symbol:'COIN'}),'COIN');
  assert.equal(alertCoinLabel({mint:'123456789',name:' ',symbol:' '}),'12345…6789');
});

test('first sightings above $250k do not notify, but subsequent return and crossing still do',()=>{
  const {store,pool,move}=setup();
  try {
    store.saveCandidate({...store.candidate(pool.mint)!,capRange:'unknown'});
    move(21_174_126,now+1000);
    assert.equal(store.alerts().alerts.length,0);assert.equal(store.candidate(pool.mint)?.capRange,'above');
    assert.ok(store.activity('grouping',pool.mint).events.some(e=>e.summary==='First observed above $250k'));
    move(200_000,now+2000);move(280_000,now+3000);
    assert.deepEqual(store.alerts().alerts.map(a=>a.message),['Moved above $250k','Returned to $30k–$250k']);
  } finally {store.close();}
});

test('legacy first-above discoveries are retained but do not fill notifications or unread counts',()=>{
  const {store,pool,move}=setup();
  try {
    move(25_000,now+1000);const below=store.alerts().alerts[0];
    store.db.prepare('INSERT INTO alerts(mint,pool,observed_at,data) VALUES(?,?,?,?)').run(pool.mint,pool.address,now+2000,JSON.stringify({...below,policyVersion:undefined,from:'unknown',to:'above',marketCap:21_174_126}));
    assert.equal(store.alerts().alerts.length,1);assert.equal(store.unreadAlerts(),1);
    assert.equal(store.alerts(Number.MAX_SAFE_INTEGER,1,true).alerts[0].to,'below');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM alerts').get()!.n,2);
  } finally {store.close();}
});

test('below-range colours cover exact 10k, 20k and 30k boundaries without colouring unknown caps',()=>{
  for(const cap of [0,9999.99])assert.equal(belowCapTone(cap),'cap-red');
  for(const cap of [10_000,19999.99])assert.equal(belowCapTone(cap),'cap-orange');
  for(const cap of [20_000,29999.99])assert.equal(belowCapTone(cap),'cap-yellow');
  for(const cap of [30_000,250_000,null,undefined,NaN,-1])assert.equal(belowCapTone(cap),'');
});

test('Updates groups exact token identities across pools and pages without deleting events',()=>{
  const {store,pool,move}=setup();
  try {
    move(270_000,now+1000);const template=store.alerts().alerts[0];
    const add=(mint:string,poolAddress:string,time:number)=>store.db.prepare('INSERT INTO alerts(mint,pool,observed_at,data) VALUES(?,?,?,?)')
      .run(mint,poolAddress,time,JSON.stringify({...template,mint,pool:poolAddress,observedAt:time}));
    add('SecondMint','SecondPool',now+2000);
    add(pool.mint,'SecondaryPoolForSameToken',now+3000);
    add('ThirdMint','ThirdPool',now+4000);
    add('SecondMint','SecondPool',now+5000);
    add(pool.mint,pool.address,now+6000);
    const page=store.updates(Number.MAX_SAFE_INTEGER,2);
    assert.equal(page.unread,3,'the badge counts coins, not events');
    assert.deepEqual(page.threads.map(t=>t.latest.mint),[pool.mint,'SecondMint']);
    assert.deepEqual(page.threads.map(t=>t.totalEvents),[3,2]);
    assert.equal(page.threads[0].history[0].pool,'SecondaryPoolForSameToken');
    const older=store.updates(page.nextBefore!,2);
    assert.deepEqual(older.threads.map(t=>t.latest.mint),['ThirdMint']);
    assert.equal(older.nextBefore,null);
    assert.equal(store.alerts().alerts.length,6,'all original events remain available');
  }finally{store.close();}
});

test('reading a coin clears its earlier updates but preserves other coins and arrivals after the displayed cutoff',()=>{
  const {store,pool,move}=setup();
  try {
    move(270_000,now+1000);move(60_000,now+2000);
    const displayed=store.updates().threads[0].latest;
    store.markAlertsRead(displayed.id,now+2500,true);
    assert.equal(store.updates(Number.MAX_SAFE_INTEGER,50,true).threads[0].latest.id,displayed.id,'older unread history retains the coin with its latest state');
    move(25_000,now+3000);
    const other={...displayed,mint:'OtherMint',pool:'OtherPool',observedAt:now+4000};
    store.db.prepare('INSERT INTO alerts(mint,pool,observed_at,data) VALUES(?,?,?,?)').run(other.mint,other.pool,other.observedAt,JSON.stringify(other));
    store.markCoinAlertsRead(pool.mint,displayed.id,now+5000);
    const unread=store.updates(Number.MAX_SAFE_INTEGER,50,true);
    assert.equal(unread.unread,2);
    const coin=unread.threads.find(t=>t.latest.mint===pool.mint)!;
    assert.equal(coin.unreadCount,1,'the new arrival stays unread');
    assert.ok(coin.history.every(a=>a.readAt!==null));
    store.markCoinAlertsRead(pool.mint,coin.latest.id,now+6000);
    assert.deepEqual(store.updates(Number.MAX_SAFE_INTEGER,50,true).threads.map(t=>t.latest.mint),['OtherMint']);
    assert.equal(store.alerts().alerts.length,4);
  }finally{store.close();}
});
