(()=>{
  try{
    document.documentElement.dataset.chesspublisherWebView='1.03.14';
    window.__cpWebViewVersion='1.03.14';
    const post=(message)=>{ try{ window.chrome.webview.postMessage(message); }catch(_){} };

    // Native TRF folder bridge. The installed WebView host writes exports to
    // <Tournament folder>\\TRF and replies with the exact Windows path.
    let cpNativeRequestSequence=0;
    const cpNativePending=new Map();
    try{
      window.chrome.webview.addEventListener('message',(event)=>{
        const message=event?.data;
        if(!message||message.type!=='cp:trf-result'||!message.requestId) return;
        const pending=cpNativePending.get(String(message.requestId));
        if(!pending) return;
        cpNativePending.delete(String(message.requestId));
        clearTimeout(pending.timer);
        if(message.ok) pending.resolve(message);
        else pending.reject(new Error(message.error||'Windows TRF operation failed.'));
      });
    }catch(_){}

    const cpNativeTrfRequest=(operation,payload={})=>new Promise((resolve,reject)=>{
      const requestId=`trf-${Date.now()}-${++cpNativeRequestSequence}`;
      const timer=setTimeout(()=>{
        cpNativePending.delete(requestId);
        reject(new Error('Windows TRF operation timed out.'));
      },15000);
      cpNativePending.set(requestId,{resolve,reject,timer});
      try{
        window.chrome.webview.postMessage({
          type:'cp:trf',requestId,operation,
          tournamentName:String(payload.tournamentName||''),
          tournamentFilePath:String(payload.tournamentFilePath||''),
          fileName:String(payload.fileName||''),
          text:payload.text==null?'':String(payload.text)
        });
      }catch(error){
        clearTimeout(timer);cpNativePending.delete(requestId);reject(error);
      }
    });
    window.cpNativeSaveTournamentTRF=(payload)=>cpNativeTrfRequest('write',payload);
    window.cpNativeEnsureTournamentTRFFolder=(payload)=>cpNativeTrfRequest('ensure',payload);

    // Native PGN folder bridge. Each tournament owns a PGN folder that can be
    // watched directly by the Lichess Broadcaster App.
    let cpNativePgnRequestSequence=0;
    const cpNativePgnPending=new Map();
    try{
      window.chrome.webview.addEventListener('message',(event)=>{
        const message=event?.data;
        if(!message||message.type!=='cp:pgn-result'||!message.requestId) return;
        const pending=cpNativePgnPending.get(String(message.requestId));
        if(!pending) return;
        cpNativePgnPending.delete(String(message.requestId));
        clearTimeout(pending.timer);
        if(message.ok) pending.resolve(message);
        else pending.reject(new Error(message.error||'Windows PGN operation failed.'));
      });
    }catch(_){}

    const cpNativePgnRequest=(operation,payload={})=>new Promise((resolve,reject)=>{
      const requestId=`pgn-${Date.now()}-${++cpNativePgnRequestSequence}`;
      const timer=setTimeout(()=>{
        cpNativePgnPending.delete(requestId);
        reject(new Error('Windows PGN operation timed out.'));
      },15000);
      cpNativePgnPending.set(requestId,{resolve,reject,timer});
      try{
        window.chrome.webview.postMessage({
          type:'cp:pgn',requestId,operation,
          tournamentName:String(payload.tournamentName||''),
          tournamentFilePath:String(payload.tournamentFilePath||''),
          fileName:String(payload.fileName||''),
          text:payload.text==null?'':String(payload.text)
        });
      }catch(error){
        clearTimeout(timer);cpNativePgnPending.delete(requestId);reject(error);
      }
    });
    window.cpNativeSaveTournamentPGN=(payload)=>cpNativePgnRequest('write',payload);
    window.cpNativeEnsureTournamentPGNFolder=(payload)=>cpNativePgnRequest('ensure',payload);

    // Core compatibility helper; do not change the tournament model for WebView.
    if(typeof window.cpSetDocumentPath!=='function'){
      window.cpSetDocumentPath=(path)=>{ try{ setOpenedTournamentFilePath(path||''); }catch(_){} };
    }

    // WebView 1.03.14 retains the real Windows title bar and native window frame.
    // Keep only ChessPublisher's Saved / Autosave / Save controls by moving
    // them into the classic menu bar, then remove the simulated HTML frame.
    const appWindow=document.getElementById('appWindow');
    const titlebar=appWindow?.querySelector('.titlebar');
    const controls=titlebar?.querySelector('.window-controls');
    const menuBar=document.getElementById('classicMenuBar');

    if(controls && menuBar && !controls.dataset.webviewNativeToolbar){
      controls.dataset.webviewNativeToolbar='1';
      controls.querySelectorAll('button:not(.titlebar-save)').forEach(button=>button.remove());
      menuBar.appendChild(controls);
    }

    const style=document.createElement('style');
    style.id='chesspublisherWebViewNativeWindowStyle';
    style.textContent=`
      html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important}
      body{padding:0!important;background:#d4d0c8!important}
      #appWindow{
        position:fixed!important;inset:0!important;
        width:100vw!important;height:100vh!important;
        min-width:0!important;min-height:0!important;
        max-width:none!important;max-height:none!important;
        margin:0!important;border:0!important;box-shadow:none!important;
      }
      #appWindow>.titlebar{display:none!important}
      #appWindow>.app-resize-handle{display:none!important;pointer-events:none!important}
      #classicMenuBar .window-controls{margin-left:auto!important;color:#000!important;height:22px!important}
      #classicMenuBar .window-controls .save-indicator{min-width:54px!important;color:#246400!important;font-size:10px!important;text-align:right!important;white-space:nowrap!important}
      #classicMenuBar .window-controls .save-indicator.dirty{color:#8a5a00!important}
      #classicMenuBar .window-controls .autosave-text{color:#000!important}
      #classicMenuBar .window-controls .titlebar-save{height:20px!important;min-height:20px!important;padding:0 7px!important}
    `;
    document.head.appendChild(style);

    // If any old core action invokes these helpers, delegate to Windows rather
    // than creating a second simulated window state inside the HTML document.
    window.minimizeAppWindow=function(event){
      try{ event&&event.stopPropagation(); }catch(_){}
      try{ window.chrome.webview.postMessage('cp:minimize'); }catch(_){}
    };
    window.toggleMaximizeAppWindow=function(event){
      try{ event&&event.stopPropagation(); }catch(_){}
      try{ window.chrome.webview.postMessage('cp:maximize'); }catch(_){}
    };
    window.closeAppWindow=async function(event){
      try{ event&&event.stopPropagation(); }catch(_){}
      try{ if(typeof fileSaveTournament==='function') await fileSaveTournament(true); }catch(_){}
      post('cp:close');
    };
  }catch(error){
    console.error('ChessPublisher WebView adapter:',error);
  }
})();
