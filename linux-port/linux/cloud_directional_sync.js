(()=>{
  "use strict";
  // Disable the legacy Cloud auto-backup immediately, before DOMContentLoaded.
  // Desktop Autosave remains local-only; the directional policy is loaded below.
  try{localStorage.setItem("ChessPublisherCloudWorkspace_AutoSync_v1","0");}catch(_){ }
  const parts=[1,2,3,4,5,6,7,8].map(n=>`/linux/cloud_directional_sync.part${String(n).padStart(2,"0")}`);
  Promise.all(parts.map(async url=>{
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok)throw new Error(`Directional Cloud Sync component failed: ${url} HTTP ${response.status}`);
    return response.text();
  })).then(chunks=>{
    (0,eval)(chunks.join(""));
  }).catch(error=>{
    console.error("Chess-Publisher directional Cloud Sync failed closed:",error);
  });
})();
