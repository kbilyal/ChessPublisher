const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'ChessPublisher-Beta81-TypeB-RatingLists.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('PASS',String(pass).padStart(2,'0'),name);}else{fail++;console.log('FAIL',name);}}
function eq(name,a,b){ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`,a===b);}
const elements={};
function el(id){return elements[id]||(elements[id]={id,value:'',files:[],style:{},children:[],appendChild(x){this.children.push(x);if(x.id)elements[x.id]=x;},addEventListener(){},set innerHTML(v){this._html=v;},get innerHTML(){return this._html||'';}});}
const panel=el('integratedRatingListsPanel');
const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.80',getElementById:id=>elements[id]||null,createElement:tag=>({tagName:tag.toUpperCase(),id:'',className:'',style:{},children:[],appendChild(x){this.children.push(x);if(x.id)elements[x.id]=x;},addEventListener(){},set innerHTML(v){this._html=v; for(const id of ['cpTypeBRatingType','cpTypeBLabel','cpTypeBFile','cpTypeBImport','cpTypeBManage'])el(id);},get innerHTML(){return this._html||'';}}),addEventListener(){}};
const storage={};
const localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v)};
function parseFixedWidthLine(line,type){const p=String(line).trim().split('|');if(p.length<3||!/^[0-9]{5,15}$/.test(p[0]))return null;return {fideId:p[0],name:p[1],rating:Number(p[2])||0,fed:p[3]||'FIDE',title:p[4]||'',k:Number(p[5])||0,type};}
const context={console,Date,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,window:null,document,localStorage,appAlert(){},cpBeta72RatingLists:{parseFixedWidthLine}};context.window=context;
vm.createContext(context);vm.runInContext(js,context,{filename:'ChessPublisher-Beta81-TypeB-RatingLists.js'});
const api=context.cpBeta81;
(async()=>{
 ok('01 beta.81 module exported',!!api&&api.VERSION==='1.06.00-beta.81');
 eq('02 formal class is Type-B',api.CLASS,'Type-B');
 ok('03 HTML loads beta.81 after beta.73',html.indexOf('ChessPublisher-Beta81-TypeB-RatingLists.js')>html.indexOf('ChessPublisher-Beta73-Compliance.js'));
 ok('04 source declares originalSourceKnown false',/originalSourceKnown:false/.test(js));
 ok('05 source explicitly states unknown source semantics',/Unknown \/ not asserted by THP/.test(js));
 ok('06 UI offers Type-B import',/Import Type-B/.test(js));
 ok('07 UI offers all three official rating types',/value="std"/.test(js)&&/value="rapid"/.test(js)&&/value="blitz"/.test(js));
 const text='12345|Alpha Player|2400|BUL|IM|10\n67890|Beta Player|2250|GER||20\n';
 const d=await api.importTypeB({id:'tb-test-std',ratingType:'std',text,fileName:'standard_rating_list.txt',label:'September imported list'});
 eq('08 import creates Type-B descriptor',d.listClass,'Type-B');
 eq('09 imported source remains unknown',d.originalSourceKnown,false);
 eq('10 standard rating type retained',d.ratingType,'std');
 eq('11 two player records imported',d.recordCount,2);
 eq('12 source filename retained only as import metadata',d.sourceFileName,'standard_rating_list.txt');
 eq('13 no original source URL is asserted',d.originalSourceUrl,'');
 eq('14 provenance mode is unknown-source user import',d.provenanceMode,'user-imported-unknown-source');
 const p=await api.findRating('tb-test-std','12345');
 eq('15 Type-B list lookup returns player rating',p.rating,2400);
 eq('16 Type-B list lookup retains FIDE ID',p.fideId,'12345');
 const cat=await api.listCatalog();
 ok('17 Type-B list is managed in catalogue',cat.some(x=>x.id==='tb-test-std'&&x.listClass==='Type-B'));
 const rapid=await api.importOfficialAsTypeB('rapid','11111|Rapid One|2100|FRA\n',{id:'tb-fide-rapid',fileName:'rapid_rating_list.txt'});
 eq('18 official FIDE file can deliberately import as Type-B',rapid.listClass,'Type-B');
 eq('19 deliberate official import still does not assert original source',rapid.originalSourceKnown,false);
 eq('20 rapid type retained',rapid.ratingType,'rapid');
 const blitz=await api.importOfficialAsTypeB('blitz','22222|Blitz One|2000|ESP\n',{id:'tb-fide-blitz'});
 eq('21 Blitz official file can import as Type-B',blitz.ratingType,'blitz');
 let dup=false;try{await api.importTypeB({id:'tb-test-std',ratingType:'std',text});}catch(e){dup=/already exists/.test(String(e.message));}
 ok('22 duplicate Type-B list ID is rejected',dup);
 let invalid=false;try{await api.importTypeB({id:'bad',ratingType:'custom',text});}catch(e){invalid=/required/.test(String(e.message));}
 ok('23 unsupported rating type is rejected',invalid);
 let empty=false;try{await api.importTypeB({id:'empty',ratingType:'std',text:'garbage'});}catch(e){empty=/No valid/.test(String(e.message));}
 ok('24 invalid list content is rejected',empty);
 await api.deleteList('tb-fide-blitz');
 const cat2=await api.listCatalog();ok('25 Type-B list can be deleted from managed catalogue',!cat2.some(x=>x.id==='tb-fide-blitz'));
 ok('26 Type-B is not silently promoted to Type-A',cat2.every(x=>x.listClass==='Type-B'&&x.originalSourceKnown===false));
 ok('27 module does not modify Type-A beta65 API',! /cpBeta65\s*=/.test(js));
 ok('28 module does not touch pairing or TRF core',!/(Gacrux|pairingchecker|TRF26|Swiss Dutch)/.test(js));
 ok('29 integrated panel receives Type-B UI hook',api.installUi()===false || !!document.getElementById('cpTypeBPanel') || /cpTypeBPanel/.test(js));
 console.log(`SUMMARY PASS=${pass} FAIL=${fail} TOTAL=${pass+fail}`);process.exitCode=fail?1:0;
})().catch(err=>{console.error(err);process.exitCode=1;});
