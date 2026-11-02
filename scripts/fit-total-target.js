// scripts/fit-total-target.js
//
// Where should a total projection regress to?
//
//   node scripts/fit-total-target.js
//
// Two-thirds of a total projection is the shrinkage target (RATING_SHRINK_TOTAL
// is 0.325), so the target decides most of every total. It was a fixed
// constant, 231.2 — last season's league mean — which pulled every total back
// to last season's scoring even once this season's form was in the ratings.
//
// This walks two full seasons forward with the season blend in force (k=10,
// gate at 6 games) and compares that fixed target against the league mean of
// the BLENDED ratings at each date. Run on 2025-26 and 2024-25 it found:
//
//   2025-26  fixed   RMSE 19.640  bias -2.21   blended  RMSE 19.573  bias -0.12
//   2024-25  fixed   RMSE 19.124  bias +0.73   blended  RMSE 19.118  bias -0.18
//
// Scoring rose into one season and fell into the other; the blended target
// tracks both. projectGame now regresses toward 2 x leagueContext.pointsFor.

require('./_loader.cjs');
const axios=require('axios');
const { ratingsFromStandings, blendWeight } = require('../src/data/espnRatings.js');
const { MODEL_CONSTANTS } = require('../src/models/nbaSimulator.js');
const SB='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ST='https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const months=y=>[`${y-1}10`,`${y-1}11`,`${y-1}12`,`${y}01`,`${y}02`,`${y}03`,`${y}04`];
(async()=>{
  for (const season of [2026, 2025]) {
    const {data:st}=await axios.get(`${ST}?season=${season-1}`);
    const prior=ratingsFromStandings(st);
    const fx=[];
    for(const m of months(season)){
      const {data}=await axios.get(`${SB}?dates=${m}&limit=1000`);
      for(const e of data.events??[]){
        if(!e.status?.type?.completed||e.season?.type!==2)continue;
        const c=e.competitions[0];const h=c.competitors.find(x=>x.homeAway==='home'),a=c.competitors.find(x=>x.homeAway==='away');
        fx.push({date:e.date,home:h.team.abbreviation,away:a.team.abbreviation,hs:+h.score,as:+a.score});
      }
    }
    fx.sort((x,y)=>x.date<y.date?-1:1);
    const acc={}; const touch=c=>(acc[c]=acc[c]??{n:0,pf:0,pa:0});
    const fixedTarget=2*prior.league.pointsFor;
    const S=MODEL_CONSTANTS.RATING_SHRINK_TOTAL;
    let seA=0,seB=0,n=0,biasA=0,biasB=0;
    for(const f of fx){
      // Blended league mean at this date: every team's blended points for.
      let sumPF=0,cnt=0;
      for(const [code,pe] of Object.entries(prior.teams)){
        const s=acc[code]; const w=s?blendWeight(s.n):0;
        sumPF += w>0 ? pe.pointsFor*(1-w)+(s.pf/s.n)*w : pe.pointsFor; cnt++;
      }
      const blendedTarget=2*sumPF/cnt;
      const side=(code)=>{const pe=prior.teams[code]; if(!pe) return null; const s=acc[code]; const w=s?blendWeight(s.n):0;
        return {pf: w>0?pe.pointsFor*(1-w)+(s.pf/s.n)*w:pe.pointsFor, pa: w>0?pe.pointsAgainst*(1-w)+(s.pa/s.n)*w:pe.pointsAgainst, pace: pe.ratings.pace};};
      const H=side(f.home), A=side(f.away);
      if(H&&A){
        // League rating on the SAME blended scale, as the production matchup step uses.
        const lr=(sumPF/cnt)/prior.league.pace*100;
        const poss=(H.pace+A.pace)/2;
        const hs=((H.pf/H.pace*100)*((A.pa/A.pace*100)/lr)/100)*poss;
        const as=((A.pf/A.pace*100)*((H.pa/H.pace*100)/lr)/100)*poss;
        const unshrunk=hs+as, actual=f.hs+f.as;
        const tA=fixedTarget+S*(unshrunk-fixedTarget);
        const tB=blendedTarget+S*(unshrunk-blendedTarget);
        seA+=(tA-actual)**2; seB+=(tB-actual)**2; biasA+=tA-actual; biasB+=tB-actual; n++;
      }
      for(const [code,pf,pa] of [[f.home,f.hs,f.as],[f.away,f.as,f.hs]]){const s=touch(code); s.n++; s.pf+=pf; s.pa+=pa;}
    }
    console.log(`${season-1}-${String(season).slice(2)}: ${n} games`);
    console.log(`  fixed target ${fixedTarget.toFixed(1)} (in force)   total RMSE ${Math.sqrt(seA/n).toFixed(3)}  bias ${(biasA/n>=0?'+':'')}${(biasA/n).toFixed(2)}`);
    console.log(`  blended league target            total RMSE ${Math.sqrt(seB/n).toFixed(3)}  bias ${(biasB/n>=0?'+':'')}${(biasB/n).toFixed(2)}`);
  }
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
