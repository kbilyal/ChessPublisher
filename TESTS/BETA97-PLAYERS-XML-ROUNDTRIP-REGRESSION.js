"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','ChessPublisher.html'),'utf8');
const sectionStart=html.indexOf("function cpPlayersXmlEscape");
const sectionEnd=html.indexOf("/* =========================================================\n   TXT EXPORT",sectionStart);
if(sectionStart<0||sectionEnd<0)throw new Error("Players XML exporter section not found");
const xmlSection=html.slice(sectionStart,sectionEnd);
const players=[
 {swissManagerUniqueId:'19',pairingNumber:2,name:'Bilyal, Kyamran',fed:'BUL',rating:1782,birth:'1989',title:'',fideId:'2935236',nationalId:'',nationalRating:0,gender:'m',source:'FIDE',fideK:20},
 {pairingNumber:10,name:'Ahmed, Berk',fed:'BUL',rating:0,birth:'-',title:'',fideId:'-',gender:'m',source:'',fideK:0}
];
const ctx={
  console,data:{currentTournament:'Крумовград , с.Токачка SYNCED'},
  getCurrentTournament:()=>({players}),startingListExportPlayers:()=>players,
  normalizePlayerTitle:v=>String(v||'').trim().toUpperCase(),
  normalizePlayerGender:v=>String(v||'').trim().toLowerCase()==='m'?'m':'',
  Number,String,Object,Error
};
vm.createContext(ctx);
vm.runInContext(xmlSection,ctx);
const xml=vm.runInContext('buildPlayersXML()',ctx);
let pass=0;const check=(c,m)=>{if(!c)throw new Error('FAIL '+m);pass++;console.log('PASS '+m);};
check(xml.startsWith('<?xml version="1.0"?>\r\n<Players>'),'XML header/root');
check(xml.includes('<Tournament Key="" Name="Крумовград , с.Токачка SYNCED"/>'),'Tournament Name preserved');
check(xml.includes('PlayerUniqueId="19" PlayerSno="2" Lastname="Bilyal" Firstname="Kyamran"'),'supplied Players.XML identity/name profile');
check(xml.includes('Federation="BUL" Rating="1782" Birthday="19890000"'),'rating and year-only birthday profile');
check(xml.includes('FIDEId="2935236"'),'FIDE ID preserved');
check(xml.includes('Source="FIDE"'),'Source preserved');
check(xml.includes('FIDEFactor="20"'),'FIDE K-factor preserved');
check(xml.includes('FIDEId="0"')&&xml.includes('Birthday="0"'),'missing FIDE/birth fields serialize as zero like supplied profile');
check(/<Player [^>]*PlayerSno="10"[^>]*\/>/.test(xml),'second player exported');
check(xml.endsWith('</Players>\r\n'),'XML closes cleanly');
console.log(`BETA97 PLAYERS XML ROUNDTRIP PROFILE: ${pass} PASS / 0 FAIL`);
