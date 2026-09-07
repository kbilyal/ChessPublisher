(()=>{
  "use strict";
  if(window.__cpLinuxWebViewShimLoaded)return;
  window.__cpLinuxWebViewShimLoaded=true;
  document.documentElement.dataset.chesspublisherPlatform="linux";

  const listeners=new Set();
  const dispatch=data=>{ for(const fn of [...listeners]){ try{ fn({data}); }catch(e){ console.error("Linux bridge listener",e); } } };
  const nativeFetch=window.fetch.bind(window);

  // Linux desktop/cloud traffic is passed through the local engine. This avoids
  // Chromium CORS/preflight differences while keeping Worker secrets out of UI.
  window.fetch=async function(input,init={}){
    let url="";
    if(typeof input==="string")url=input;
    else if(input instanceof URL)url=input.href;
    else if(input&&typeof input.url==="string")url=input.url;
    const worker="https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev";
    if(url.startsWith(worker)){
      const proxied="/proxy/hub-api"+url.slice(worker.length);
      return nativeFetch(proxied,init);
    }
    return nativeFetch(input,init);
  };

  function openPlaceholder(){
    try{
      const popup=window.open("about:blank","_blank");
      try{if(popup)popup.opener=null;}catch(_){}
      return popup;
    }catch(_){return null;}
  }

  async function localChessResults(operation,payload={}){
    const r=await nativeFetch(`/chessresults/${encodeURIComponent(operation)}`,{
      method:"POST",
      headers:{"Content-Type":"application/json;charset=utf-8","Accept":"application/json"},
      body:JSON.stringify(payload||{}),
      cache:"no-store"
    });
    let p={};
    try{p=await r.json();}catch(_){}
    if(!r.ok||!p?.ok)throw new Error(p?.error||`Chess-Results service HTTP ${r.status}`);
    return p;
  }

  function navigatePlaceholder(popup,url){
    if(!url)throw new Error("Chess-Results did not return an authenticated browser URL.");
    if(popup&&!popup.closed){
      try{popup.location.replace(url);return;}catch(_){}
      try{popup.location.href=url;return;}catch(_){}
    }
    const opened=window.open(url,"_blank","noopener");
    if(!opened)throw new Error("The browser blocked the Chess-Results window. Allow pop-ups for this local Chess-Publisher page and retry.");
  }

  async function postMessage(message){
    try{
      if(typeof message==="string"){
        if(message==="cp:close"||message==="cp:minimize"||message==="cp:maximize")return;
        const upload=/^cp:cr-upload:(\d+):(\d+)$/.exec(message);
        if(upload){
          const popup=openPlaceholder();
          try{
            const result=await localChessResults("admin-link",{key:upload[1],language:Number(upload[2])||1,section:"upload"});
            navigatePlaceholder(popup,result.url||result.adminUrl);
          }catch(error){
            try{if(popup&&!popup.closed)popup.close();}catch(_){}
            console.error("Chess-Results UploadData",error);
          }
          return;
        }
        return;
      }
      if(!message||typeof message!=="object")return;
      if(message.type==="cp:hub-secret"){
        const r=await nativeFetch("/native/secret",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:message.operation,key:message.key,value:message.value||""})});
        const p=await r.json().catch(()=>({}));
        dispatch({type:"cp:hub-secret-result",requestId:message.requestId,ok:r.ok&&p.ok!==false,found:!!p.found,value:p.value||"",error:p.error||""});
        return;
      }
      if(message.type==="cp:trf"){
        if(message.operation==="ensure"){
          dispatch({type:"cp:trf-result",requestId:message.requestId,ok:true,path:"Linux managed TRF folder"});
          return;
        }
        const r=await nativeFetch("/tournament/trf-export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(message)});
        const p=await r.json().catch(()=>({}));
        dispatch({type:"cp:trf-result",requestId:message.requestId,ok:r.ok&&!!p.ok,path:p.path||"",error:p.error||""});
        return;
      }
      if(message.type==="cp:dgt"){
        dispatch({type:"cp:dgt-result",requestId:message.requestId,ok:false,error:"DGT native Linux provider is not connected in the current development build."});
        return;
      }
      if(message.type==="cp:cr-delete"||message.type==="cp:cr-delete-other"){
        const key=String(message.key||"").trim();
        if(!/^\d+$/.test(key))throw new Error("Chess-Results TNR is missing or invalid.");
        const popup=openPlaceholder();
        try{
          const auth=await localChessResults("delete-authorize",{
            key,
            clientId:String(message.clientId||""),
            language:Number(message.language)||1
          });
          if(auth.alreadyDeleted===true){
            const unlinked=await localChessResults("unlink",{key,clientId:String(message.clientId||""),serverError:""});
            if(unlinked.canUnlink!==true)throw new Error(unlinked.reason||"Chess-Results deletion was confirmed, but the local ownership link could not be released.");
            try{if(popup&&!popup.closed)popup.close();}catch(_){}
            dispatch({type:"cp:cr-delete-result",requestId:message.requestId,ok:true,deleted:true,alreadyDeleted:true,manual:false});
            return;
          }
          const adminUrl=String(auth.adminUrl||auth.url||"").trim();
          if(auth.canDelete!==true||!adminUrl)throw new Error(auth.reason||"Chess-Results deletion was not authorized for this tournament.");
          navigatePlaceholder(popup,adminUrl);
          dispatch({
            type:"cp:cr-delete-result",requestId:message.requestId,ok:false,deleted:false,manual:true,adminUrl,
            error:"Authenticated Chess-Results Admin opened. Delete the tournament there, then use Unlink deleted tournament. The local TNR was kept for safety."
          });
        }catch(error){
          try{if(popup&&!popup.closed&&popup.location?.href==="about:blank")popup.close();}catch(_){}
          dispatch({type:"cp:cr-delete-result",requestId:message.requestId,ok:false,deleted:false,error:error?.message||String(error)});
        }
        return;
      }
    }catch(error){
      const type=message?.type==="cp:hub-secret"?"cp:hub-secret-result":message?.type==="cp:trf"?"cp:trf-result":"cp:linux-result";
      dispatch({type,requestId:message?.requestId||"",ok:false,error:error?.message||String(error)});
    }
  }

  window.chrome=window.chrome||{};
  window.chrome.webview={
    postMessage(message){ void postMessage(message); },
    addEventListener(type,fn){ if(type==="message"&&typeof fn==="function")listeners.add(fn); },
    removeEventListener(type,fn){ if(type==="message")listeners.delete(fn); }
  };

  window.addEventListener("DOMContentLoaded",()=>{
    try{
      const bar=document.createElement("div");
      bar.id="cpLinuxDevBadge";
      bar.textContent="Linux development build · LocalEngine 0.3 · protected tournament core preserved";
      bar.style.cssText="position:fixed;right:12px;bottom:8px;z-index:2147483647;padding:5px 9px;border-radius:6px;background:#202020;color:#ddd;font:11px/1.2 system-ui;opacity:.82;pointer-events:none";
      document.body.appendChild(bar);
    }catch(_){ }
  },{once:true});
})();
