/* Chess-Publisher Website v29 — in-modal FIDE rating impact analysis.
   Website-only feature. No remote FIDE lookup is performed here; calculations use
   the tournament snapshot plus optional K/rating metadata when it is published. */
(()=>{
  'use strict';

  const DP_POSITIVE=Object.freeze([
    0,7,14,21,29,36,43,50,57,65,72,80,87,95,102,110,117,125,133,141,149,158,166,175,184,193,
    202,211,220,230,240,251,262,273,284,296,309,322,336,351,366,383,401,422,444,470,501,538,589,677,800
  ]); // index 0 => p=.50, index 50 => p=1.00

  const PD_RANGES=Object.freeze([
    [3,.50],[10,.51],[17,.52],[25,.53],[32,.54],[39,.55],[46,.56],[53,.57],[61,.58],[68,.59],
    [76,.60],[83,.61],[91,.62],[98,.63],[106,.64],[113,.65],[121,.66],[129,.67],[137,.68],[145,.69],
    [153,.70],[162,.71],[170,.72],[179,.73],[188,.74],[197,.75],[206,.76],[215,.77],[225,.78],[235,.79],
    [245,.80],[256,.81],[267,.82],[278,.83],[290,.84],[302,.85],[315,.86],[328,.87],[344,.88],[357,.89],
    [374,.90],[391,.91],[411,.92],[432,.93],[456,.94],[484,.95],[517,.96],[559,.97],[619,.98],[735,.99]
  ]);

  const PLAYED_RESULTS=new Set(['1-0','1:0','0-1','0:1','1/2-1/2','½-½','0.5-0.5']);

  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  };

  const firstNumber=(...values)=>{
    for(const value of values){
      const n=number(value);
      if(n!==null&&n>0)return n;
    }
    return null;
  };

  function discipline(data){
    const explicit=[data?.ratingType,data?.ratingCategory,data?.timeControlType,data?.discipline,data?.timeControl]
      .filter(Boolean).join(' ').toLowerCase();
    if(/\bblitz\b/.test(explicit))return 'blitz';
    if(/\brapid\b/.test(explicit))return 'rapid';
    if(/\bstandard\b|\bclassical\b/.test(explicit))return 'standard';

    const tc=String(data?.timeControl||'').trim();
    const inc=tc.match(/(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)/);
    if(inc){
      const base=Number(inc[1]);
      const increment=Number(inc[2]);
      const minutesFor60Moves=base+increment; // 60 × increment seconds = increment minutes
      if(minutesFor60Moves>10&&minutesFor60Moves<60)return 'rapid';
      if(minutesFor60Moves>3&&minutesFor60Moves<=10)return 'blitz';
      return 'standard';
    }
    const mins=tc.match(/(?:^|\b)(\d+(?:\.\d+)?)\s*(?:min|minutes?)\b/i);
    if(mins){
      const m=Number(mins[1]);
      if(m>10&&m<60)return 'rapid';
      if(m>3&&m<=10)return 'blitz';
    }
    return 'standard';
  }

  function disciplineLabel(value){
    return value==='rapid'?'Rapid':value==='blitz'?'Blitz':'Standard';
  }

  function ratingFromPlayer(player,type,{allowStandardFallback=true}={}){
    const ratings=player?.ratings||{};
    const direct=type==='standard'
      ? firstNumber(ratings.standard,player?.standardRating,player?.ratingStandard,player?.stdRating,player?.fideStandardRating,player?.rating)
      : type==='rapid'
        ? firstNumber(ratings.rapid,player?.rapidRating,player?.ratingRapid,player?.fideRapidRating,player?.rating)
        : firstNumber(ratings.blitz,player?.blitzRating,player?.ratingBlitz,player?.fideBlitzRating,player?.rating);
    if(direct)return {rating:Math.round(direct),source:'event'};

    if(type!=='standard'&&allowStandardFallback){
      const standard=firstNumber(ratings.standard,player?.standardRating,player?.ratingStandard,player?.stdRating,player?.fideStandardRating);
      if(standard)return {rating:Math.round(standard),source:'standard-fallback'};
    }
    return {rating:null,source:'unrated'};
  }

  function birthYear(player){
    const direct=firstNumber(player?.birthYear,player?.yearOfBirth,player?.yob);
    if(direct&&direct>=1900&&direct<=2200)return Math.round(direct);
    const raw=String(player?.birthDate||player?.dateOfBirth||player?.dob||'').trim();
    const m=raw.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return m?Number(m[1]):null;
  }

  function kFactor(player,type,rating,data){
    const kObj=player?.kFactors||player?.kFactorByType||{};
    const specific=type==='standard'
      ? firstNumber(kObj.standard,player?.standardK,player?.kStandard,player?.sk)
      : type==='rapid'
        ? firstNumber(kObj.rapid,player?.rapidK,player?.kRapid,player?.rk)
        : firstNumber(kObj.blitz,player?.blitzK,player?.kBlitz,player?.bk);
    const generic=firstNumber(player?.kFactor,player?.ratingK,player?.k);
    const published=specific||generic;
    if(published)return {base:Math.round(published),source:'published',note:'K factor published with the tournament data.'};

    if(rating>=2400)return {base:10,source:'rule-certain',note:'K=10 follows from the current published rating being at least 2400.'};

    const y=birthYear(player);
    const eventDate=String(data?.date||data?.startDate||data?.updatedAt||'');
    const yearMatch=eventDate.match(/((?:19|20)\d{2})/);
    const eventYear=yearMatch?Number(yearMatch[1]):new Date().getUTCFullYear();
    if(y&&eventYear<=y+18&&rating<2300){
      return {base:40,source:'rule-certain',note:'K=40 applies through the end of the year of the player’s 18th birthday while the rating remains below 2300.'};
    }
    if(player?.newToRatingList===true||player?.isNewRatedPlayer===true){
      return {base:40,source:'published-status',note:'K=40 uses the published new-to-rating-list status.'};
    }

    return {base:20,source:'assumed',note:'K=20 is assumed because the Hub snapshot does not include the player’s official K. New or junior players may have K=40, and a player who previously reached 2400 may have K=10.'};
  }

  function dpFromFraction(p){
    const clamped=Math.max(0,Math.min(1,Number(p)||0));
    const pct=Math.max(0,Math.min(100,Math.round(clamped*100)));
    if(pct===50)return 0;
    if(pct>50)return DP_POSITIVE[pct-50];
    return -DP_POSITIVE[50-pct];
  }

  function highProbability(diff){
    const d=Math.max(0,Number(diff)||0);
    for(const [max,p] of PD_RANGES){if(d<=max)return p;}
    return 1;
  }

  function expectedScore(playerRating,opponentRating,type){
    const pr=Number(playerRating),or=Number(opponentRating);
    const rawDiff=Math.abs(pr-or);
    let usedDiff=rawDiff;
    if(type==='standard'){
      if(pr<2650)usedDiff=Math.min(rawDiff,400);
    }else{
      usedDiff=Math.min(rawDiff,400);
    }
    const high=highProbability(usedDiff);
    return {pd:pr>=or?high:1-high,rawDiff,usedDiff};
  }

  function normalizeResult(raw){
    return String(raw??'').trim().toUpperCase().replace(/\s+/g,'');
  }

  function isPlayedResult(raw){return PLAYED_RESULTS.has(normalizeResult(raw));}

  function roundFide(value){
    const n=Number(value)||0;
    if(n>=0)return Math.floor(n+0.5+1e-10);
    return Math.ceil(n-0.5-1e-10);
  }

  function resolveOpponent(data,item){
    const snapshot=item?.opponent||{};
    if(snapshot?.key){
      const full=(data?.players||[]).find(p=>String(p?.key)===String(snapshot.key));
      if(full)return {...snapshot,...full};
    }
    return snapshot;
  }

  function ratedGameEntries(data,player,history,type,playerRating){
    return (history||[]).map(item=>{
      const opponent=resolveOpponent(data,item);
      const oppInfo=ratingFromPlayer(opponent,type,{allowStandardFallback:true});
      const raw=item?.rawResult;
      const base={...item,opponent,opponentRating:oppInfo.rating,opponentRatingSource:oppInfo.source,ratingEligible:false,exclusionReason:'',pd:null,deltaR:null};
      if(!isPlayedResult(raw)){
        base.exclusionReason=item?.result?.kind==='bye'?'Bye / unplayed game':'Unplayed, forfeit or pending result';
        return base;
      }
      if(item?.result?.score===null||item?.result?.score===undefined){
        base.exclusionReason='Result is not a rating score';
        return base;
      }
      if(!oppInfo.rating){
        base.exclusionReason='Opponent is unrated';
        return base;
      }
      if((type==='rapid'||type==='blitz')&&Math.abs(playerRating-oppInfo.rating)>=600&&(playerRating>2600||oppInfo.rating>2600)){
        base.exclusionReason='FIDE Rapid/Blitz 600-point rule';
        return base;
      }
      const exp=expectedScore(playerRating,oppInfo.rating,type);
      base.ratingEligible=true;
      base.pd=exp.pd;
      base.ratingDifference=exp.rawDiff;
      base.ratingDifferenceUsed=exp.usedDiff;
      base.deltaR=Number(item.result.score)-exp.pd;
      return base;
    });
  }

  function performanceRating(entries){
    if(!entries.length)return null;
    const score=entries.reduce((sum,g)=>sum+Number(g.result.score||0),0);
    const aro=entries.reduce((sum,g)=>sum+g.opponentRating,0)/entries.length;
    return Math.round(aro+dpFromFraction(score/entries.length));
  }

  function analyseRated(data,player,history,type,playerInfo){
    const currentRating=playerInfo.rating;
    const allGames=ratedGameEntries(data,player,history,type,currentRating);
    const games=allGames.filter(g=>g.ratingEligible);
    const n=games.length;
    const score=games.reduce((sum,g)=>sum+Number(g.result.score||0),0);
    const aro=n?games.reduce((sum,g)=>sum+g.opponentRating,0)/n:null;
    const k=kFactor(player,type,currentRating,data);
    const periodLimitedK=n&&k.base*n>700?Math.floor(700/n):k.base;
    const rawChange=games.reduce((sum,g)=>sum+g.deltaR,0)*periodLimitedK;
    const roundedChange=roundFide(rawChange);
    const enriched=allGames.map(g=>g.ratingEligible?{...g,ratingPoints:g.deltaR*periodLimitedK}:g);
    const warnings=[];
    if(k.source==='assumed')warnings.push(k.note);
    if(periodLimitedK!==k.base)warnings.push(`K is reduced to ${periodLimitedK} for this tournament-only estimate because K × n may not exceed 700 in a rating period.`);
    if(n&&k.base*n<=700)warnings.push('Other rated games in the same monthly rating period can change the final rounded rating change and, for high game counts, the effective K.');
    if(type!=='standard'&&playerInfo.source==='standard-fallback')warnings.push(`The player is treated as rated using the Standard rating (${currentRating}) because no ${disciplineLabel(type)} rating is published in the snapshot.`);
    return {
      mode:'rated',type,typeLabel:disciplineLabel(type),currentRating,playerRatingSource:playerInfo.source,
      games:enriched,ratedGames:n,score,aro,performance:performanceRating(games),
      k:{...k,effective:periodLimitedK},rawChange,roundedChange,estimatedNewRating:currentRating+roundedChange,warnings
    };
  }

  function analyseInitial(data,player,history,type){
    const entries=(history||[]).map(item=>{
      const opponent=resolveOpponent(data,item);
      const oppInfo=ratingFromPlayer(opponent,type,{allowStandardFallback:true});
      const raw=item?.rawResult;
      const base={...item,opponent,opponentRating:oppInfo.rating,opponentRatingSource:oppInfo.source,ratingEligible:false,exclusionReason:''};
      if(!isPlayedResult(raw)){
        base.exclusionReason=item?.result?.kind==='bye'?'Bye / unplayed game':'Unplayed, forfeit or pending result';
        return base;
      }
      if(item?.result?.score===null||item?.result?.score===undefined){base.exclusionReason='Result is not a rating score';return base;}
      if(!oppInfo.rating){base.exclusionReason='Opponent is unrated';return base;}
      base.ratingEligible=true;
      return base;
    });
    const rated=entries.filter(g=>g.ratingEligible);
    const n=rated.length;
    const score=rated.reduce((sum,g)=>sum+Number(g.result.score||0),0);
    if(!n){
      return {mode:'initial',type,typeLabel:disciplineLabel(type),games:entries,ratedGames:0,score:0,initialRating:null,warnings:['No played games against rated opponents are available in this tournament snapshot.']};
    }
    const opponentTotal=rated.reduce((sum,g)=>sum+g.opponentRating,0);
    const withDummyGames=n+2;
    const withDummyScore=score+1; // two 1800 opponents, draw vs each
    const ra=(opponentTotal+3600)/withDummyGames;
    const p=withDummyScore/withDummyGames;
    const dp=dpFromFraction(p);
    const uncapped=Math.round(ra+dp);
    const initialRating=Math.min(2200,uncapped);
    const warnings=[];
    if(n<5)warnings.push(`FIDE publishes an initial rating only after at least 5 games against rated opponents; this tournament currently provides ${n}. Qualifying games can be pooled across consecutive rating periods up to 26 months.`);
    if(initialRating<1400)warnings.push('An initial rating below 1400 is not published on the FIDE rating list.');
    if(score===0)warnings.push('If this is the player’s first rated event, FIDE disregards a zero score for the initial-rating calculation.');
    if(type!=='standard')warnings.push(`For ${disciplineLabel(type)}, an otherwise unrated player who already had a Standard rating at the start of the event must be treated as rated using that Standard rating. The Hub can apply this automatically when a Standard rating is included in the player snapshot.`);
    return {
      mode:'initial',type,typeLabel:disciplineLabel(type),games:entries,ratedGames:n,score,aro:opponentTotal/n,
      dummyOpponents:2,dummyRating:1800,dummyScore:1,ra,p,dp,uncappedInitialRating:uncapped,initialRating,
      publishable:n>=5&&initialRating>=1400,warnings
    };
  }

  function analyseTournament(data,player,history){
    const type=discipline(data);
    const playerInfo=ratingFromPlayer(player,type,{allowStandardFallback:true});
    if(playerInfo.rating)return analyseRated(data,player,history,type,playerInfo);
    return analyseInitial(data,player,history,type);
  }

  window.ChessPublisherRating=Object.freeze({
    analyseTournament,discipline,disciplineLabel,dpFromFraction,expectedScore,roundFide,isPlayedResult
  });
})();
