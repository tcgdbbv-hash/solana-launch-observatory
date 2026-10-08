import type { SnapshotPoint, SnapshotScreen } from '../shared/candle-policy.ts';

const hour = 3_600_000;
const median = (xs: number[]) => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)] ?? 0;
const spread = (xs: number[]) => {
  const sorted=[...xs].sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.floor((sorted.length-1)*.9)]-sorted[Math.floor((sorted.length-1)*.1)] : 0;
};
// A scheduling hint only. True candles and existing formation rules remain the admission gate.
export function screenSnapshots(points: SnapshotPoint[], now: number): SnapshotScreen {
  const empty: SnapshotScreen={at:now,score:0,promising:false,coverage:0,hours:0,width:null,slope:null,contraction:null,reasons:['Building an observed price history']};
  const valid=points.filter(p=>p.time<=now&&p.time>=now-7*24*hour&&p.price!==null&&Number.isFinite(p.price)&&p.price>0)
    .sort((a,b)=>a.time-b.time);
  if(valid.length<8||now-valid.at(-1)!.time>10*60_000)return empty;
  // Never mix providers or pool orientations into an apparent price move.
  const source=valid.at(-1)!.source;
  const same=valid.filter(p=>p.source===source);
  let best=empty;
  for(const hours of [1,2,4,8,24,48,168]) {
    const rows=same.filter(p=>p.time>=now-hours*hour);
    if(rows.length<8||rows.at(-1)!.time-rows[0].time<hours*hour*.7)continue;
    const buckets=new Set(rows.map(p=>Math.floor(p.time/300_000)));
    const coverage=Math.min(1,buckets.size/(hours*12));
    if(coverage<.65)continue;
    const xs=rows.map(p=>(p.time-rows[0].time)/hour),ys=rows.map(p=>Math.log(p.price!));
    const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length;
    const denom=xs.reduce((s,x)=>s+(x-xm)**2,0);
    const slope=ys.reduce((s,y,i)=>s+(xs[i]-xm)*(y-ym),0)/denom;
    const residual=ys.map((y,i)=>y-(ym+slope*(xs[i]-xm)));
    const width=(Math.exp(spread(residual))-1)*100,trend=(Math.exp(slope)-1)*100;
    const mid=Math.floor(rows.length/2),earlier=spread(residual.slice(0,mid)),recent=spread(residual.slice(mid));
    const contraction=earlier>0?recent/earlier:null;
    const active=rows.filter(p=>(p.buys??0)+(p.sells??0)>0).length/rows.length;
    const liquidity=rows.flatMap(p=>p.liquidity!==null&&p.liquidity>=0?[p.liquidity]:[]);
    const lastLiquidity=rows.at(-1)!.liquidity, typicalLiquidity=median(liquidity);
    const usableLiquidity=lastLiquidity!==null&&lastLiquidity>=1000&&typicalLiquidity>0&&lastLiquidity>=typicalLiquidity*.65;
    // Same-duration volume observations are compared, never summed into trade totals.
    const earlierVolume=rows.slice(0,mid).flatMap(p=>p.volume5m!==null?[p.volume5m]:[]);
    const laterVolume=rows.slice(mid).flatMap(p=>p.volume5m!==null?[p.volume5m]:[]);
    const quieting=earlierVolume.length>0&&laterVolume.length>0&&median(earlierVolume)>0&&median(laterVolume)<=median(earlierVolume);
    const lastStep=Math.abs(ys.at(-1)!-ys.at(-2)!);
    const promising=width<=30&&trend>=-2&&trend<=8&&active>=.5&&usableLiquidity&&lastStep<Math.log(1.15);
    const score=Math.round(Math.max(0,30-width)+Math.max(0,Math.min(10,trend*2))+(contraction!==null&&contraction<.8?15:0)
      +(quieting?5:0)+Math.min(10,Math.log2(hours+1)*3));
    const result: SnapshotScreen={at:now,score:promising?score:0,promising,coverage,hours,width,slope:trend,contraction,
      reasons:promising?[trend>=1?'Sampled price is settling along a gentle rise':'Sampled price is holding a narrower range',
        ...(contraction!==null&&contraction<.8?['Recent swings have contracted']:[]),'Trading continues and reported liquidity remains available']
        :['Sampled history does not yet suggest a settled active range']};
    if(result.score>best.score||best.hours===0)best=result;
  }
  return best;
}
