
/* Chess-Publisher Windows Fluidity Preview v2 */
(function(){
  'use strict';
  if(window.__cpWindowsFluidityV2Loaded)return;
  window.__cpWindowsFluidityV2Loaded=true;

  const FAST_PAGE_IDS=new Set(['main','registration','pairings','standings','exportPage','schedule','chessresults']);
  const TAB_BY_PAGE={
    main:'tabMain',registration:'tabRegistration',pairings:'tabPairings',
    standings:'tabStandings',exportPage:'tabExport',schedule:'tabSchedule',
    chessresults:'tabChessResults',dgt:'tabDgt'
  };
  const stats={
    fastSwitches:0,dirtySwitches:0,guardedMissingTargets:0,
    skippedStaleWork:0,samples:[]
  };
  window.__cpWindowsFluidityStats=stats;

  function enabled(){return !!document.body?.classList?.contains('cp-fluidity-on');}
  function activePage(){return document.querySelector('.page.active')?.id||'';}
  function dirtyState(){
    try{return typeof stateDirty!=='undefined'?!!stateDirty:true;}
    catch(_){return true;}
  }
  function tabFor(id,button){
    if(button?.classList)return button;
    return document.getElementById(TAB_BY_PAGE[id]||'');
  }
  function record(ms){
    stats.samples.push(ms);
    if(stats.samples.length>120)stats.samples.shift();
    const metric=document.getElementById('cpFluidityMetric');
    if(metric){
      const avg=stats.samples.length
        ? stats.samples.reduce((a,b)=>a+b,0)/stats.samples.length : 0;
      metric.textContent=`avg ${avg.toFixed(2)} ms · fast ${stats.fastSwitches} · stale ${stats.skippedStaleWork}`;
    }
  }

  /* Do not execute delayed work for a tab after the user already left it. */
  function guardTabWork(name,pageId){
    const original=window[name];
    if(typeof original!=='function'||original.__cpFluidGuarded)return;
    function guarded(){
      if(enabled()&&activePage()!==pageId){
        stats.skippedStaleWork++;
        return undefined;
      }
      return original.apply(this,arguments);
    }
    guarded.__cpFluidGuarded=true;
    guarded.__cpOriginal=original;
    window[name]=guarded;
  }

  function installDeferredWorkGuards(){
    for(const name of [
      'populatePairingsRoundMenu','renderLivePairings','loadPairingEngineSettings',
      'renderNextRoundPlayerManager','updateGacruxPanel'
    ]) guardTabWork(name,'pairings');

    for(const name of [
      'renderSpecialPrizeSettings','refreshFinalStandings','renderSpecialPrizeResults'
    ]) guardTabWork(name,'standings');

    guardTabWork('refreshChessResultsXmlUi','chessresults');
  }

  function installNavigation(){
    const original=window.showTab;
    if(typeof original!=='function'||window.__cpWindowsFluidShowTabWrapped)return;

    window.__cpWindowsOriginalShowTab=original;
    window.showTab=function(id,button){
      const started=performance.now();
      try{
        if(!enabled())return original.call(this,id,button);

        const pageId=String(id||'');
        const target=document.getElementById(pageId);
        const tab=tabFor(pageId,button);
        if(!target||!tab){
          stats.guardedMissingTargets++;
          return undefined;
        }
        if(tab.classList.contains('disabled')){
          return original.call(this,pageId,tab);
        }

        const previousId=activePage();
        if(previousId===pageId&&tab.classList.contains('active'))return;

        const dirty=dirtyState();
        const canFast=FAST_PAGE_IDS.has(pageId)&&previousId!=='dgt'&&!dirty;
        if(!canFast){
          if(dirty)stats.dirtySwitches++;
          return original.call(this,pageId,tab);
        }

        /*
          Preserve the original navigation and tab-specific functions.
          Suppress only redundant persistence when the tournament is clean.
        */
        const originalSaveAll=window.saveAll;
        const originalSaveData=window.saveData;
        if(typeof originalSaveAll==='function')window.saveAll=function(){};
        if(typeof originalSaveData==='function')window.saveData=function(){};
        try{
          stats.fastSwitches++;
          return original.call(this,pageId,tab);
        }finally{
          if(typeof originalSaveAll==='function')window.saveAll=originalSaveAll;
          if(typeof originalSaveData==='function')window.saveData=originalSaveData;
        }
      }finally{
        record(performance.now()-started);
      }
    };
    window.__cpWindowsFluidShowTabWrapped=true;
  }

  function normalizeWindow(){
    const app=document.getElementById('appWindow');
    if(!app)return;
    app.classList.remove('app-window-minimized');
    delete app.dataset.restoreWindowStyle;
    for(const name of [
      'position','left','top','width','height','margin',
      'max-width','max-height','transform'
    ]) app.style.removeProperty(name);
  }

  function ensureChessResultsTab(){
    const tabs=document.querySelector('#appWindow .tabs');
    let tab=document.getElementById('tabChessResults');
    if(!tabs)return;
    if(!tab){
      tab=document.createElement('div');
      tab.id='tabChessResults';
      tab.className='tab';
      tab.textContent='Chess-Results';
      tab.onclick=function(){window.showTab?.('chessresults',tab);};
      tabs.appendChild(tab);
    }
    tab.hidden=false;
    tab.style.removeProperty('display');
    tab.style.removeProperty('visibility');
  }

  function setFluidity(on){
    document.body.classList.toggle('cp-fluidity-on',!!on);
    localStorage.setItem('cpWindowsFluidityPreviewV2',on?'1':'0');
    normalizeWindow();
    ensureChessResultsTab();
    const state=document.getElementById('cpFluidityState');
    const button=document.getElementById('cpFluidityToggle');
    if(state)state.textContent=on?'ON':'OFF';
    if(button)button.textContent=on?'Turn OFF':'Turn ON';
  }

  function panel(){
    if(document.getElementById('cpFluidityPanel'))return;
    const box=document.createElement('div');
    box.id='cpFluidityPanel';
    box.innerHTML=
      '<b>Windows Fluidity <span id="cpFluidityState">ON</span></b>'+ 
      '<span class="cp-v2">v2</span>'+ 
      '<span class="cp-metric" id="cpFluidityMetric">avg 0.00 ms · fast 0 · stale 0</span>'+ 
      '<button id="cpFluidityToggle" type="button">Turn OFF</button>'+ 
      '<span class="cp-metric">F8 = A/B</span>';
    document.body.appendChild(box);
    document.getElementById('cpFluidityToggle')
      .addEventListener('click',()=>setFluidity(!enabled()));
  }

  function install(){
    ensureChessResultsTab();
    installDeferredWorkGuards();
    installNavigation();
    panel();

    const remembered=localStorage.getItem('cpWindowsFluidityPreviewV2');
    setFluidity(remembered!=='0');

    window.addEventListener('keydown',event=>{
      if(event.key==='F8'){
        event.preventDefault();
        setFluidity(!enabled());
      }
    },true);

    /* Re-check after the application finishes its own startup. */
    setTimeout(()=>{
      ensureChessResultsTab();
      installDeferredWorkGuards();
      installNavigation();
    },0);
    setTimeout(()=>{
      ensureChessResultsTab();
      installDeferredWorkGuards();
    },250);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',install,{once:true});
  }else{
    install();
  }
})();
