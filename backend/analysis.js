// TRUSTFX MARKET STRUCTURE ENGINE — STAGE 3.5
// Coherent sequence: sweep -> matching displacement -> matching BOS/CHoCH
// -> matching FVG -> later retest. No complete sequence = WAIT.

const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const t = c => String(c.datetime || c.time || c.date || "");
const o = c => n(c.open), h = c => n(c.high), l = c => n(c.low), cl = c => n(c.close);
const body = c => Math.abs(cl(c)-o(c)), range = c => h(c)-l(c);
const uw = c => h(c)-Math.max(o(c),cl(c)), lw = c => Math.min(o(c),cl(c))-l(c);
const bull = c => cl(c)>o(c), bear = c => cl(c)<o(c);

function normalize(raw) {
  return (Array.isArray(raw)?raw:[]).map(c=>({...c,open:o(c),high:h(c),low:l(c),close:cl(c)}))
    .filter(c=>t(c)&&h(c)>=l(c))
    .sort((a,b)=>new Date(t(a)).getTime()-new Date(t(b)).getTime());
}

function avgBody(c,i,lookback=20) {
  const a=[];
  for(let k=Math.max(0,i-lookback);k<i;k++) a.push(body(c[k]));
  return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
}

function swings(c) {
  const highs=[],lows=[];
  for(let i=2;i<c.length-2;i++) {
    let hi=true,lo=true;
    for(let k=1;k<=2;k++) {
      if(h(c[i])<=h(c[i-k])||h(c[i])<=h(c[i+k])) hi=false;
      if(l(c[i])>=l(c[i-k])||l(c[i])>=l(c[i+k])) lo=false;
    }
    if(hi) highs.push({index:i,price:h(c[i]),time:t(c[i])});
    if(lo) lows.push({index:i,price:l(c[i]),time:t(c[i])});
  }
  return {highs,lows};
}

function structureOf(s) {
  const hs=s.highs.slice(-2),ls=s.lows.slice(-2);
  const ph=hs.length===2?hs[0].price:null;
  const sh=hs.length?hs[hs.length-1].price:null;
  const pl=ls.length===2?ls[0].price:null;
  const sl=ls.length?ls[ls.length-1].price:null;

  const HH=ph!==null&&sh>ph;
  const LH=ph!==null&&sh<ph;
  const HL=pl!==null&&sl>pl;
  const LL=pl!==null&&sl<pl;

  let trend="NEUTRAL",structure="UNDEFINED";

  if(HH&&HL){trend="BULLISH";structure="HH + HL";}
  else if(LH&&LL){trend="BEARISH";structure="LH + LL";}
  else if(HH){trend="BULLISH";structure="HH";}
  else if(HL){trend="BULLISH";structure="HL";}
  else if(LH){trend="BEARISH";structure="LH";}
  else if(LL){trend="BEARISH";structure="LL";}

  return {
    trend,structure,HH,HL,LH,LL,sh,sl,ph,pl,
    lastHigh:hs.at(-1)||null,
    lastLow:ls.at(-1)||null,
    highs:s.highs,
    lows:s.lows
  };
}

function findSweeps(c,s) {
  const out=[];

  for(let i=Math.max(0,c.length-35);i<c.length;i++) {

    // SELL-SIDE SWEEP = potential bullish setup
    for(let j=s.lows.length-1;j>=0;j--) {
      const q=s.lows[j];
      if(q.index>=i) continue;

      if(l(c[i])<q.price&&cl(c[i])>q.price) {
        const wick=lw(c[i]),b=body(c[i]);

        out.push({
          type:"SELL-SIDE SWEEP",
          direction:"BULLISH",
          index:i,
          time:t(c[i]),
          level:q.price,
          wick,
          body:b,
          range:range(c[i]),
          rejection:range(c[i])>0&&wick>=b*.25
        });

        break;
      }
    }

    // BUY-SIDE SWEEP = potential bearish setup
    for(let j=s.highs.length-1;j>=0;j--) {
      const q=s.highs[j];
      if(q.index>=i) continue;

      if(h(c[i])>q.price&&cl(c[i])<q.price) {
        const wick=uw(c[i]),b=body(c[i]);

        out.push({
          type:"BUY-SIDE SWEEP",
          direction:"BEARISH",
          index:i,
          time:t(c[i]),
          level:q.price,
          wick,
          body:b,
          range:range(c[i]),
          rejection:range(c[i])>0&&wick>=b*.25
        });

        break;
      }
    }
  }

  return out.sort((a,b)=>a.index-b.index);
}

function displacementAfter(c,sweep) {
  for(
    let i=sweep.index+1;
    i<=Math.min(c.length-1,sweep.index+10);
    i++
  ) {
    const av=avgBody(c,i);
    const b=body(c[i]);
    const dir=bull(c[i])?"BULLISH":bear(c[i])?"BEARISH":"NONE";

    if(av>0&&b>=av*1.2&&dir===sweep.direction) {
      return {
        detected:true,
        direction:dir,
        index:i,
        time:t(c[i]),
        candleBody:b,
        averageBody:av,
        threshold:av*1.2,
        linkedSweep:sweep
      };
    }
  }

  return null;
}

function breakAfter(c,s,d) {
  for(
    let i=d.index;
    i<=Math.min(c.length-1,d.index+10);
    i++
  ) {
    if(d.direction==="BULLISH") {
      const q=s.highs.filter(x=>x.index<i).at(-1);

      if(q&&cl(c[i])>q.price) {
        const ch=s.trend==="BEARISH";

        return {
          detected:true,
          index:i,
          time:t(c[i]),
          direction:d.direction,
          bos:!ch,
          bosDirection:ch?"NONE":d.direction,
          choch:ch,
          chochDirection:ch?d.direction:"NONE",
          brokenLevel:q.price,
          brokenLevelTime:q.time
        };
      }
    } else {
      const q=s.lows.filter(x=>x.index<i).at(-1);

      if(q&&cl(c[i])<q.price) {
        const ch=s.trend==="BULLISH";

        return {
          detected:true,
          index:i,
          time:t(c[i]),
          direction:d.direction,
          bos:!ch,
          bosDirection:ch?"NONE":d.direction,
          choch:ch,
          chochDirection:ch?d.direction:"NONE",
          brokenLevel:q.price,
          brokenLevelTime:q.time
        };
      }
    }
  }

  return null;
}

function fvgAfter(c,d) {
  for(
    let i=Math.max(2,d.index);
    i<=Math.min(c.length-1,d.index+5);
    i++
  ) {
    // Bullish FVG
    if(
      d.direction==="BULLISH"&&
      l(c[i])>h(c[i-2])
    ) {
      return {
        detected:true,
        direction:"BULLISH",
        bullish:true,
        bearish:false,
        high:l(c[i]),
        low:h(c[i-2]),
        index:i,
        time:t(c[i])
      };
    }

    // Bearish FVG
    if(
      d.direction==="BEARISH"&&
      h(c[i])<l(c[i-2])
    ) {
      return {
        detected:true,
        direction:"BEARISH",
        bullish:false,
        bearish:true,
        high:l(c[i-2]),
        low:h(c[i]),
        index:i,
        time:t(c[i])
      };
    }
  }

  return {
    detected:false,
    direction:"NONE",
    bullish:false,
    bearish:false,
    high:null,
    low:null,
    index:null,
    time:null
  };
}

function invalidatedAfter(c,f) {
  if(!f.detected) return false;

  for(let i=f.index+1;i<c.length;i++) {
    if(
      (f.direction==="BULLISH"&&cl(c[i])<f.low)||
      (f.direction==="BEARISH"&&cl(c[i])>f.high)
    ) {
      return true;
    }
  }

  return false;
}

function retestAfter(c,f,bk,invalid) {
  if(!f.detected||invalid) {
    return {
      retest:false,
      index:null,
      time:null,
      position:"NONE"
    };
  }

  for(
    let i=Math.max(f.index+1,bk.index+1);
    i<c.length;
    i++
  ) {
    if(l(c[i])<=f.high&&h(c[i])>=f.low) {
      return {
        retest:i===c.length-1,
        index:i,
        time:t(c[i]),
        position:
          cl(c[i])>f.high?"ABOVE":
          cl(c[i])<f.low?"BELOW":
          "INSIDE"
      };
    }
  }

  return {
    retest:false,
    index:null,
    time:null,
    position:"OUTSIDE"
  };
}

function risk(direction,entry,sweep) {
  if(!sweep) {
    return {
      stopLoss:null,
      takeProfit1:null,
      takeProfit2:null,
      takeProfit3:null
    };
  }

  const stopLoss=sweep.level;
  const dist=Math.abs(entry-stopLoss);

  if(
    !dist||
    (direction==="BUY"&&stopLoss>=entry)||
    (direction==="SELL"&&stopLoss<=entry)
  ) {
    return {
      stopLoss:null,
      takeProfit1:null,
      takeProfit2:null,
      takeProfit3:null
    };
  }

  const sign=direction==="BUY"?1:-1;

  return {
    stopLoss,
    takeProfit1:entry+sign*dist*1.5,
    takeProfit2:entry+sign*dist*2,
    takeProfit3:entry+sign*dist*3
  };
}

export function analyzeMarketStructure(rawCandles) {
  const c=normalize(rawCandles);

  if(c.length<30) {
    return {
      status:"INSUFFICIENT_DATA",
      message:"Not enough candles for market structure analysis.",
      candleCount:c.length
    };
  }

  const cur=c.at(-1);
  const price=cl(cur);
  const s=swings(c);
  const st=structureOf(s);
  const events=findSweeps(c,s);

  let chain=null;

  // Find one coherent chain, starting from the newest sweep.
  for(let k=events.length-1;k>=0;k--) {
    const sw=events[k];

    if(!sw.rejection) continue;

    const d=displacementAfter(c,sw);

    if(
      !d||
      d.direction!==sw.direction||
      d.index<=sw.index
    ) continue;

    const bk=breakAfter(c,s,d);

    if(
      !bk||
      bk.direction!==sw.direction||
      bk.index<d.index
    ) continue;

    const f=fvgAfter(c,d);

    if(
      !f.detected||
      f.direction!==sw.direction||
      f.index<d.index
    ) continue;

    const inv=invalidatedAfter(c,f);
    const rt=retestAfter(c,f,bk,inv);

    chain={
      sweep:sw,
      displacement:d,
      structureBreak:bk,
      fvg:f,
      invalidated:inv,
      retest:rt,
      validOrder:true
    };

    break;
  }

  const sw=chain?.sweep||events.at(-1)||null;

  const d=chain?.displacement||
    (sw&&sw.rejection?displacementAfter(c,sw):null);

  const bk=chain?.structureBreak||
    (d?breakAfter(c,s,d):null);

  const f=chain?.fvg||
    (d?fvgAfter(c,d):{
      detected:false,
      direction:"NONE",
      bullish:false,
      bearish:false,
      high:null,
      low:null,
      index:null,
      time:null
    });

  const inv=chain?.invalidated??invalidatedAfter(c,f);

  const rt=chain?.retest||
    (bk?retestAfter(c,f,bk,inv):{
      retest:false,
      index:null,
      time:null,
      position:"NONE"
    });

  const disp=d||{
    detected:false,
    direction:"NONE",
    index:null,
    time:null,
    candleBody:0,
    averageBody:0,
    threshold:0,
    linkedSweep:null
  };

  const br=bk||{
    detected:false,
    direction:"NONE",
    index:null,
    time:null,
    bos:false,
    bosDirection:"NONE",
    choch:false,
    chochDirection:"NONE",
    brokenLevel:null,
    brokenLevelTime:null
  };

  const dir=sw?.direction||"NONE";

  const entryDir=
    dir==="BULLISH"?"BUY":
    dir==="BEARISH"?"SELL":
    "NONE";

  const nowRetest=Boolean(
    rt.retest&&rt.index===c.length-1
  );

  const candleAgrees=
    entryDir==="BUY"?bull(cur):
    entryDir==="SELL"?bear(cur):
    false;

  const confirmed=Boolean(
    chain&&!inv&&nowRetest&&candleAgrees
  );

  const entryPrice=confirmed?price:null;

  const levels=confirmed?
    risk(entryDir,price,sw):
    {
      stopLoss:null,
      takeProfit1:null,
      takeProfit2:null,
      takeProfit3:null
    };

  const score=[
    Boolean(sw?.rejection),
    Boolean(d&&d.index>sw.index&&d.direction===dir),
    Boolean(bk&&bk.direction===dir),
    Boolean(f.detected&&f.direction===dir),
    Boolean(f.detected&&!inv),
    nowRetest,
    confirmed,
    Boolean(chain)
  ].filter(Boolean).length;

  const reason=
    confirmed?null:
    !sw?"No liquidity sweep found":
    !sw.rejection?"Sweep did not meet rejection rule":
    !d?"No matching displacement after sweep":
    !bk?"No matching BOS/CHoCH after displacement":
    !f.detected?"No matching FVG after displacement":
    f.direction!==dir?"Sweep, displacement and FVG directions conflict":
    inv?"FVG invalidated":
    !nowRetest?"Waiting for a later FVG retest candle":
    !candleAgrees?"Retest candle does not confirm entry direction":
    "No complete chronological setup chain";

  return {
    status:confirmed?entryDir:"WAIT",
    candleOrder:"ASCENDING",
    trend:st.trend,
    structure:st.structure,

    bos:br.bos,
    bosDirection:br.bosDirection,
    choch:br.choch,
    chochDirection:br.chochDirection,

    currentPrice:price,

    swingHigh:st.sh,
    swingLow:st.sl,
    previousSwingHigh:st.ph,
    previousSwingLow:st.pl,

    higherHigh:st.HH,
    higherLow:st.HL,
    lowerHigh:st.LH,
    lowerLow:st.LL,

    lastSwingHighTime:st.lastHigh?.time||null,
    lastSwingLowTime:st.lastLow?.time||null,

    liquidity:{
      status:sw?
        (dir==="BULLISH"?
          "CONFIRMED SELL-SIDE SWEEP":
          "CONFIRMED BUY-SIDE SWEEP"):
        "NO SWEEP",

      buySideLiquidity:st.sh,
      sellSideLiquidity:st.sl,
      previousBuySideLiquidity:st.ph,
      previousSellSideLiquidity:st.pl,

      sweep:Boolean(sw),
      sweepDirection:dir,
      rejection:Boolean(sw?.rejection),
      rejectionDirection:dir,

      highSweep:dir==="BEARISH",
      lowSweep:dir==="BULLISH",

      bearishRejection:Boolean(
        dir==="BEARISH"&&sw?.rejection
      ),

      bullishRejection:Boolean(
        dir==="BULLISH"&&sw?.rejection
      ),

      upperWick:uw(cur),
      lowerWick:lw(cur),
      candleRange:range(cur),
      candleBody:body(cur)
    },

    displacement:{
      status:disp.detected?
        "DISPLACEMENT DETECTED":
        "NO DISPLACEMENT",

      detected:disp.detected,
      direction:disp.direction,
      time:disp.time,
      index:disp.index,

      candleBody:disp.candleBody,
      averageBody:disp.averageBody,
      threshold:disp.threshold,
      multiplier:1.2,

      linkedToSweep:Boolean(
        disp.linkedSweep&&
        sw&&
        disp.linkedSweep.index===sw.index&&
        disp.index>sw.index
      )
    },

    fvg:{
      status:f.detected?
        "RELEVANT FVG DETECTED":
        "NO RELEVANT FVG",

      detected:f.detected,
      direction:f.direction,
      bullish:f.bullish,
      bearish:f.bearish,

      high:f.high,
      low:f.low,
      index:f.index,
      time:f.time,

      invalidated:inv,
      retest:nowRetest,
      position:rt.position
    },

    setup:{
      status:confirmed?"CONFIRMED":"WAITING",
      direction:confirmed?entryDir:"NONE",

      bullishSetup:confirmed&&entryDir==="BUY",
      bearishSetup:confirmed&&entryDir==="SELL",

      sweepConfirmed:Boolean(sw?.rejection),

      displacementConfirmed:Boolean(
        d&&d.direction===dir&&d.index>sw.index
      ),

      structureBreakConfirmed:Boolean(
        bk&&bk.direction===dir&&bk.index>=d?.index
      ),

      fvgRetest:nowRetest,
      fvgInvalidated:inv
    },

    entry:{
      status:confirmed?"CONFIRMED":"WAITING",
      direction:confirmed?entryDir:"NONE",
      confirmed,
      price:entryPrice,
      ...levels
    },

    confirmationScore:score,
    maxConfirmationScore:8,
    confirmationPercent:Math.round(score/8*100),
    validThreshold:confirmed&&score>=6,

    sequence:{
      sweep:sw?{
        detected:true,
        direction:sw.direction,
        type:sw.type,
        index:sw.index,
        time:sw.time,
        level:sw.level,
        rejection:sw.rejection
      }:{
        detected:false,
        direction:"NONE",
        type:null,
        index:null,
        time:null,
        level:null,
        rejection:false
      },

      displacement:{
        detected:disp.detected,
        direction:disp.direction,
        index:disp.index,
        time:disp.time,

        linkedToSweep:Boolean(
          disp.linkedSweep&&
          sw&&
          disp.linkedSweep.index===sw.index
        )
      },

      structureBreak:{
        detected:br.detected,
        bos:br.bos,
        bosDirection:br.bosDirection,
        choch:br.choch,
        chochDirection:br.chochDirection,
        direction:br.direction,
        index:br.index,
        time:br.time,
        brokenLevel:br.brokenLevel,
        brokenLevelTime:br.brokenLevelTime
      },

      fvg:{
        detected:f.detected,
        direction:f.direction,
        index:f.index,
        time:f.time,
        retest:nowRetest,
        invalidated:inv
      },

      retest:{
        detected:rt.index!==null,
        currentCandle:nowRetest,
        index:rt.index,
        time:rt.time
      },

      validOrder:Boolean(
        chain&&
        sw.index<disp.index&&
        disp.index<=br.index&&
        br.index<=f.index&&
        f.index<(rt.index??Infinity)
      ),

      invalidReason:reason,
      complete:confirmed
    }
  };
}
