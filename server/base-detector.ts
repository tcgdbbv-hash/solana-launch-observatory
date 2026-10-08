import type { BaseAssessment, Candle, Episode, Pool } from '../shared/types.ts';
import { BASE_POLICY as policy, BASE_VERSION, tightnessTier } from '../shared/base.ts';
import { closedCandles } from './detector.ts';

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a,b)=>a-b), position=(sorted.length-1)*q;
  const low=Math.floor(position), weight=position-low;
  return sorted[low]*(1-weight)+sorted[Math.ceil(position)]*weight;
};
function tests(bars: Candle[], threshold: number, lower: boolean) {
  let count=0, last=-Infinity, touching=false;
  for(const c of bars) {
    const hit=lower?c.close<=threshold:c.close>=threshold;
    if(hit&&!touching&&c.time-last>=900){count++;last=c.time;}
    touching=hit;
  }
  return count;
}

// Fit log price against actual elapsed time. Detrending must not compress gaps,
// substitute for active trading, or let a one-way rise count as range retests.
function trend(bars: Candle[], start: number, end: number) {
  const xs=bars.map(c=>(c.time-start)/(end-start)), ys=bars.map(c=>Math.log(c.close));
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
  const variance=xs.reduce((sum,x)=>sum+(x-mx)**2,0);
  const slope=variance?xs.reduce((sum,x,i)=>sum+(x-mx)*(ys[i]-my),0)/variance:0;
  return {slope,gain:(Math.exp(slope)-1)*100,hourly:(Math.exp(slope/((end-start)/3600))-1)*100};
}
function normalized(bars: Candle[], slope: number, start: number, end: number) {
  return bars.map(c=>{
    const factor=Math.exp(slope*(1-(c.time-start)/(end-start)));
    return {...c,open:c.open*factor,high:c.high*factor,low:c.low*factor,close:c.close*factor};
  });
}
function band(bars: Candle[]) {
  const prices=bars.map(c=>c.close),floor=quantile(prices,.1),ceiling=quantile(prices,.9);
  return {floor,ceiling,width:(ceiling/floor-1)*100};
}

// The only inputs are closed candles and pump evidence available at the evaluation time.
// Pool creation is an explicit launch proxy, never a claim of bonding-curve provenance.
export function assessBase(pool: Pool, input: Candle[], episodes: Episode[], asOf: number): BaseAssessment {
  const bars=closedCandles(input,asOf), last=bars.at(-1);
  const empty: BaseAssessment={version:BASE_VERSION,pool:pool.address,mint:pool.mint,evaluatedAt:asOf,
    candleEnd:last?(last.time+300)*1000:null,status:'insufficient',reasons:[],score:0,start:null,end:null,
    durationHours:0,floor:null,ceiling:null,widthPercent:null,driftPercent:null,activePercent:null,
    floorTests:0,ceilingTests:0,volumeUsd:0,coveragePercent:0,pumpTrigger:null,pumpPeakTime:null,pumpPeak:null,
    pullbackPercent:null,launchBasis:pool.createdAt?'pool_creation':'unknown',shape:'unsettled',
    rawWidthPercent:null,trendPercentPerHour:null,trendGainPercent:null,floorStart:null,ceilingStart:null,
    tightnessTier:null,compression:'unknown',compressionRatio:null,priorityBoost:0};
  if(!last||bars.length<15)return {...empty,reasons:['More completed candles are needed to assess the pump, selloff and base.']};
  if(!pool.createdAt||pool.createdAt>asOf)return {...empty,reasons:['Pool creation time is unverified; launch proximity cannot be established.']};
  const pump=episodes.filter(e=>e.pool===pool.address&&e.signal.volumeQualified
    &&e.signal.volumeConfirmedAt!==null&&e.signal.volumeConfirmedAt*1000<=asOf
    &&e.original.start*1000>=pool.createdAt!-600_000
    &&e.original.start*1000-pool.createdAt!<=policy.launchWindowHours*3_600_000)
    .sort((a,b)=>a.original.trigger-b.original.trigger)[0];
  if(!pump)return {...empty,reasons:['A volume-supported pump near this pool’s creation has not been established.']};
  const evidence={...empty,pumpTrigger:pump.original.trigger};
  const results: BaseAssessment[]=[];
  for(const hours of policy.windowsHours) {
    const end=last.time+300,start=end-hours*3600;
    if(start<=pump.original.trigger+600)continue;
    const prior=bars.filter(c=>c.time>=pump.original.start&&c.time<start);
    if(prior.length<3)continue;
    const peak=prior.reduce((a,b)=>b.close>a.close?b:a);
    const leg=bars.filter(c=>c.time>=start&&c.time<end);
    if(leg.length<12)continue;
    const coverage=leg.length/(hours*12)*100;
    // No compressed time: omitted no-trade intervals reduce coverage and activity.
    const active=leg.filter(c=>c.volume>0).length/(hours*12)*100;
    const closes=leg.map(c=>c.close), middle=quantile(closes,.5);
    const raw=band(leg), volume=leg.reduce((sum,c)=>sum+c.volume,0);
    const first=leg.filter(c=>c.time<start+hours*1200), tail=leg.filter(c=>c.time>=end-hours*1200);
    if(!first.length||!tail.length)continue;
    const drift=(quantile(tail.map(c=>c.close),.5)/quantile(first.map(c=>c.close),.5)-1)*100;
    const fit=trend(leg,start,end), thirds=[first,leg.filter(c=>c.time>=start+hours*1200&&c.time<end-hours*1200),tail];
    const thirdsBands=thirds.filter(part=>part.length).map(band);
    const rising=fit.gain>=policy.minRisingGainPercent&&thirdsBands.length===3
      &&thirdsBands[2].floor>thirdsBands[0].floor*1.03&&thirdsBands[2].ceiling>thirdsBands[0].ceiling*1.03
      &&thirdsBands.slice(1).every((b,i)=>b.floor>=thirdsBands[i].floor*.97&&b.ceiling>=thirdsBands[i].ceiling*.97);
    const shape:BaseAssessment['shape']=rising?'rising':Math.abs(drift)<=policy.maxDriftPercent?'sideways':'unsettled';
    const relative=rising?normalized(leg,fit.slope,start,end):leg;
    const {floor,ceiling,width}=band(relative);
    const floorTests=tests(relative,floor+(ceiling-floor)*.25,true), ceilingTests=tests(relative,ceiling-(ceiling-floor)*.25,false);
    // A rising base can recover from its low. Measure the earlier selloff near the
    // start, rather than requiring the entire later recovery to remain at that low.
    const pullback=(1-(rising?quantile(first.map(c=>c.close),.5):middle)/peak.close)*100;
    const halves=[relative.filter(c=>c.time<start+hours*1800),relative.filter(c=>c.time>=start+hours*1800)];
    const halfWidths=halves.map(part=>part.length>=6?band(part).width:null);
    const comparable=halves.every(part=>part.length/(hours*6)*100>=policy.minCoveragePercent)
      &&halfWidths[0]!==null&&halfWidths[0]>=.25&&halfWidths[1]!==null;
    const compressionRatio=comparable?halfWidths[1]!/halfWidths[0]!:null;
    const compression:BaseAssessment['compression']=compressionRatio===null?'unknown'
      :compressionRatio<=.8&&halfWidths[0]!-halfWidths[1]!>=1?'tightening'
      :compressionRatio>=1.25&&halfWidths[1]!-halfWidths[0]!>=1?'widening':'steady';
    const reasons:string[]=[];
    if(coverage<policy.minCoveragePercent)reasons.push('Candle coverage is incomplete across this range.');
    if(active<policy.minActivePercent)reasons.push('Trading is too sparse to distinguish an active base from inactivity.');
    if(fit.gain< -2&&thirdsBands.length===3&&thirdsBands[2].floor<thirdsBands[0].floor*.99
      &&thirdsBands[2].ceiling<thirdsBands[0].ceiling*.99)reasons.push('The floor and ceiling are both falling; support is not holding.');
    if(width>policy.maxWidthPercent||width<.25)reasons.push(width<.25?'Too little price variation to establish repeated range tests.':'The range is still too wide.');
    if(rising) {
      const pumpHours=Math.max(1/12,(peak.time-pump.original.start)/3600);
      const pumpSlope=Math.log(peak.close/pump.original.initialClose)/pumpHours;
      if(fit.hourly>policy.maxRisingPercentPerHour||fit.slope/hours>pumpSlope*policy.maxSlopeVsPump)
        reasons.push('The climb is too fast relative to the earlier pump to count as a gradual rising base.');
      const largestStep=Math.max(...leg.slice(1).map((c,i)=>Math.log(c.close/leg[i].close)));
      if(largestStep>Math.max(Math.log(1.05),fit.slope*.5))reasons.push('A single jump dominates the apparent rising base.');
      if(leg.slice(1).filter((c,i)=>c.close<leg[i].close).length<3)reasons.push('A one-way climb has not established repeated pullbacks.');
    } else if(Math.abs(drift)>policy.maxDriftPercent||Math.abs(drift)>Math.max(3,width*.6))
      reasons.push('Price is still drifting without an established sideways or gently rising range.');
    if(floorTests<policy.minFloorTests||ceilingTests<policy.minCeilingTests)reasons.push('The floor and ceiling need more distinct tests.');
    if(pullback<policy.minPullbackPercent)reasons.push('A sufficient selloff after the earlier pump is not established.');
    if(relative.at(-1)!.close<floor*.97||relative.at(-1)!.close>ceiling*1.03)reasons.push('The latest close is outside the established range.');
    if(quantile(relative.map(c=>c.high),.95)/quantile(relative.map(c=>c.low),.05)>1.7)reasons.push('Large wick swings make this range unstable.');
    const pumpSwing=(peak.close/pump.original.initialClose-1)*100;
    if(width>pumpSwing*.4)reasons.push('The range has not contracted enough relative to the pump.');
    const priorityBoost=reasons.length?0:(rising?10:0)+(compression==='tightening'?5:0);
    const orderliness=rising?1-Math.min(1,width/40):1-Math.min(1,Math.abs(drift)/20);
    const score=Math.round(Math.min(100,Math.max(0,30*(1-width/60)+15*orderliness
      +Math.min(15,(floorTests+ceilingTests)*2)+Math.min(20,Math.log2(hours+1)*3)+Math.min(5,active/20)+priorityBoost)));
    results.push({...evidence,status:reasons.length?(active<policy.minActivePercent?'inactive':'forming'):'qualified',
      reasons:reasons.length?reasons:[`Active ${rising?'rising':'sideways'} range held for ${hours}h with ${floorTests} floor tests and ${ceilingTests} ceiling tests.`,
        `${rising?'After accounting for the slope, the central':'The central'} 80% of closes span ${width.toFixed(1)}%; median price drift ${drift.toFixed(1)}%.`,
        `Swings are ${compression} across equal halves of this ${hours}h window.${rising?' Higher lows and a gently rising ceiling add review priority; holder behaviour is not inferred.':''}`],
      score,start:start*1000,end:end*1000,durationHours:hours,floor,ceiling,widthPercent:width,driftPercent:drift,
      activePercent:active,floorTests,ceilingTests,volumeUsd:volume,coveragePercent:coverage,
      pumpPeakTime:peak.time*1000,pumpPeak:peak.close,pullbackPercent:pullback,shape,rawWidthPercent:raw.width,
      trendPercentPerHour:fit.hourly,trendGainPercent:fit.gain,
      floorStart:floor/Math.exp(rising?fit.slope:0),ceilingStart:ceiling/Math.exp(rising?fit.slope:0),
      tightnessTier:tightnessTier(width),compression,compressionRatio,priorityBoost});
  }
  return results.filter(r=>r.status==='qualified').sort((a,b)=>b.score-a.score||b.durationHours-a.durationHours)[0]
    ??results.sort((a,b)=>a.reasons.length-b.reasons.length||b.score-a.score)[0]
    ??{...evidence,reasons:['Waiting for enough post-pump history to assess an active range.']};
}
