// scripts/diagnose.js
//
// Ask the graded record which of the model's signals actually predict profit,
// rather than assuming any of them do.
//
//   node scripts/diagnose.js
//
// This exists because the model's own selector was wrong for six slates and
// nothing in the nightly output would have revealed it. Ranking rows by
// adjusted edge and publishing the top five went 4-11 for -6.23u while ranks
// 6-40 went 25-17 for +9.73u. Both ranking signals correlate with unit profit
// at about zero. A ranking has to earn its place here before anything is
// published off it.
//
// Read the buckets as a screen, not as rules. With fewer than a hundred graded
// rows, a bucket can look convincing on noise alone: the long-dog ceiling in
// BET_RULES is in force because it has a mechanism AND the record, and a raw
// edge ceiling was rejected because the record stopped supporting it once the
// dogs were removed.

require('./_loader.cjs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { settleMarket, unitProfit } = require('../src/models/settle.js');
const { priceVeto } = require('../src/models/nbaSimulator.js');
const SB='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const SM='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const DIR=path.join(__dirname,'..','board-log');

(async()=>{
  const files=fs.readdirSync(DIR).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const snaps=files.map(f=>JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8')));
  const dates=[...new Set(snaps.map(s=>s.slateDate))];
  const finals=new Map();
  for(const d of dates){
    const {data}=await axios.get(`${SB}?dates=${d.replace(/-/g,'')}&limit=1000`);
    for(const e of data.events??[]){
      if(!e.status?.type?.completed) continue;
      const c=e.competitions?.[0];
      const h=c?.competitors?.find(x=>x.homeAway==='home'), a=c?.competitors?.find(x=>x.homeAway==='away');
      if(h?.score==null) continue;
      finals.set(String(e.id),{h:+h.score,a:+a.score});
    }
  }
  const rows=[];
  for(const s of snaps){
    for(const g of s.games){
      const f=finals.get(String(g.espnId)); if(!f) continue;
      let box=null;
      if(g.markets.some(m=>m.market==='prop')){
        try{const {data}=await axios.get(`${SM}?event=${g.espnId}`);
          box={}; for(const tb of data.boxscore?.players??[])for(const grp of tb.statistics??[]){
            const keys=grp.keys??[];
            for(const ath of grp.athletes??[]){
              const n=ath.athlete?.displayName,st=ath.stats??[];
              if(!n||!st.length)continue;
              const num=k=>{const i=keys.indexOf(k);if(i<0)return null;const v=Number(String(st[i]).split('-')[0]);return Number.isFinite(v)?v:null;};
              if(num('minutes')==null)continue;
              box[n]={points:num('points'),rebounds:num('rebounds'),assists:num('assists'),
                steals:num('steals'),blocks:num('blocks'),
                threes:num('threePointFieldGoalsMade-threePointFieldGoalsAttempted')};
            }}
        }catch(e){}
      }
      // One row per market FAMILY, the side the model leaned.
      const fam=new Map();
      for(const m of g.markets){
        const k=`${m.market}:${m.line??''}:${m.player??''}`;
        const best=fam.get(k);
        if(!best||m.rawEdge>best.rawEdge) fam.set(k,m);
      }
      for(const m of fam.values()){
        if(m.rawEdge<=0) continue;
        const o=settleMarket(m,f.a,f.h,box);
        if(o===null) continue;
        rows.push({date:s.slateDate, type:m.market, rawEdge:m.rawEdge, adjEdge:m.adjustedEdge,
          conf:g.confidence, pen:g.penaltyTotal, price:m.price, win:o==='push'?null:!!o,
          units:o==='push'?0:unitProfit(m.price,o), rank:m.slateRank,
          // Would today's hard rules have kept this row?
          vetoNow:!!priceVeto(m.market,m.price)});
      }
    }
  }
  const decided=rows.filter(r=>r.win!==null);
  console.log(`${decided.length} decided leans across ${snaps.length} slates\n`);

  const show=(label,set)=>{
    if(!set.length){console.log(`  ${label.padEnd(26)} -`);return;}
    const w=set.filter(r=>r.win).length;
    const u=set.reduce((a,r)=>a+r.units,0);
    console.log(`  ${label.padEnd(26)} ${w}-${set.length-w} (${(100*w/set.length).toFixed(1)}%)  ${u>=0?'+':''}${u.toFixed(2)}u  ROI ${(100*u/set.length).toFixed(1)}%`);
  };

  console.log('BY RAW EDGE (is a bigger disagreement with the market better or worse?)');
  [[0,.03],[.03,.06],[.06,.10],[.10,1]].forEach(([lo,hi])=>
    show(`raw ${(100*lo).toFixed(0)}-${hi===1?'+':(100*hi).toFixed(0)}%`, decided.filter(r=>r.rawEdge>=lo&&r.rawEdge<hi)));

  console.log('\nBY CONFIDENCE (does the dampener identify the good rows?)');
  [[0,2.5],[2.5,4],[4,5.5],[5.5,10]].forEach(([lo,hi])=>
    show(`conf ${lo}-${hi}`, decided.filter(r=>r.conf>=lo&&r.conf<hi)));

  console.log('\nBY PUBLISHED SLATE RANK (the Top 5 selector)');
  [[1,6],[6,16],[16,41],[41,999]].forEach(([lo,hi])=>
    show(`rank ${lo}-${hi===999?'end':hi-1}`, decided.filter(r=>r.rank>=lo&&r.rank<hi)));

  console.log('\nBY MARKET TYPE');
  [...new Set(decided.map(r=>r.type))].forEach(t=>show(t, decided.filter(r=>r.type===t)));

  console.log('\nMONEYLINE BY PRICE (are longshots the leak?)');
  const ml=decided.filter(r=>r.type==='moneyline');
  show('favourites (neg price)', ml.filter(r=>r.price<0));
  show('dogs +100..+300', ml.filter(r=>r.price>=100&&r.price<300));
  show('dogs +300 or longer', ml.filter(r=>r.price>=300));

  // Correlation of raw edge with profit
  const n=decided.length;
  const mx=decided.reduce((a,r)=>a+r.rawEdge,0)/n, my=decided.reduce((a,r)=>a+r.units,0)/n;
  let sxy=0,sxx=0,syy=0;
  for(const r of decided){sxy+=(r.rawEdge-mx)*(r.units-my);sxx+=(r.rawEdge-mx)**2;syy+=(r.units-my)**2;}
  console.log(`\ncorrelation(raw edge, unit profit) = ${(sxy/Math.sqrt(sxx*syy)).toFixed(3)}`);
  const mc=decided.reduce((a,r)=>a+r.conf,0)/n;
  let cxy=0,cxx=0;
  for(const r of decided){cxy+=(r.conf-mc)*(r.units-my);cxx+=(r.conf-mc)**2;}
  console.log(`correlation(confidence, unit profit) = ${(cxy/Math.sqrt(cxx*syy)).toFixed(3)}`);
  console.log('  (both near zero means the model cannot rank its own rows,');
  console.log('   which is why nothing is published off a ranking)');

  console.log('\nRULES IN FORCE — what the long-dog ceiling removes');
  const cut=decided.filter(r=>r.vetoNow), keep=decided.filter(r=>!r.vetoNow);
  show('removed by the ceiling', cut);
  show('surviving screen', keep);
  console.log(`  the ceiling is worth ${(-cut.reduce((a,r)=>a+r.units,0)).toFixed(2)}u on this record`);

  if (decided.length < 150) {
    console.log(
      `\nCAUTION: ${decided.length} graded rows. A 10-row bucket swings ~2u on noise;` +
        '\n  treat every split above as a hypothesis, not a finding.'
    );
  }
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
