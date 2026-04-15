'use client'

import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ═══════════════════════════════════════════════════════════
// EARTH COMMAND v3 — OPERATIONS ASSURANCE EDITION
// "No order left behind. No delivery unverified. No lead forgotten."
// ═══════════════════════════════════════════════════════════

const C = {
  bg:"#04060a",s:"#090b12",card:"#0e1018",cardH:"#151720",
  b:"#191c2c",bA:"#2a2e44",
  amber:"#e8a308",amberB:"#fbbf24",amberD:"rgba(232,163,8,.12)",
  green:"#10b981",greenB:"#34d399",greenD:"rgba(16,185,129,.1)",
  red:"#ef4444",redB:"#f87171",redD:"rgba(239,68,68,.12)",
  blue:"#3b82f6",blueB:"#60a5fa",blueD:"rgba(59,130,246,.1)",
  cyan:"#06b6d4",purple:"#a78bfa",pink:"#f472b6",
  t:"#e2e8f0",tM:"#8892a8",tD:"#4a5068",
};
const m="'JetBrains Mono',monospace",sn="'DM Sans',sans-serif";

type OrderStatus =
  | "quoted" | "payment_pending" | "scheduled" | "dispatched"
  | "loading" | "in_transit" | "arriving" | "delivered" | "verified" | "complete";

type Order = {
  id: string; customer: string; driver: string | null; material: string;
  yards: number; city: string; status: OrderStatus; statusTime: number;
  value: number; phone: string; verified: boolean; photoSent: boolean;
  customerConfirmed: boolean; paid: boolean; eta: string; progress: number;
};

type HeatZone = {
  id: string; name: string; lat: number; lng: number; orders: number;
  drivers: number; revenue: number; temp: "hot"|"warm"|"cool"|"cold";
  permits: number; txdot: number;
};

type ConvMsg = { f: "cust"|"ai"|"drv"; t: string; tm: string };
type Conversation = {
  id: number; agent: "sarah"|"jesse"; name: string; phone: string;
  status: string; msgs: ConvMsg[]; value: number; yards: number;
};

type StatusConfig = {
  label: string; color: string; icon: string;
  maxMin: number | null; escalateMsg: string | null;
};

// ── ORDER LIFECYCLE (The Andon Board data) ──
const ORDERS: Order[] = [
  {id:"DS-C7EF5F",customer:"Mike Rodriguez",driver:"Carlos M.",material:"Fill Dirt",yards:90,city:"Dallas",status:"in_transit",statusTime:42,value:1080,phone:"(214)555-0187",verified:false,photoSent:false,customerConfirmed:false,paid:false,eta:"14 min",progress:72},
  {id:"DS-A3B21D",customer:"Tom Builder Inc",driver:"Marcus T.",material:"Base Course",yards:500,city:"Arlington",status:"loading",statusTime:18,value:9000,phone:"(682)555-0445",verified:false,photoSent:false,customerConfirmed:false,paid:true,eta:"45 min",progress:30},
  {id:"DS-F9E1C4",customer:"Lisa Chen",driver:"Ricky P.",material:"Topsoil",yards:45,city:"Plano",status:"arriving",statusTime:3,value:675,phone:"(972)555-0891",verified:false,photoSent:false,customerConfirmed:false,paid:true,eta:"2 min",progress:95},
  {id:"DS-2D8A7B",customer:"Big D Excavation",driver:"DeShawn B.",material:"Structural Fill",yards:200,city:"Fort Worth",status:"delivered",statusTime:22,value:3600,phone:"(817)555-0342",verified:true,photoSent:true,customerConfirmed:true,paid:true,eta:"—",progress:100},
  {id:"DS-8E3F1A",customer:"Metro Grading Co",driver:"James W.",material:"Crushed Limestone",yards:1000,city:"Fort Worth",status:"dispatched",statusTime:95,value:18000,phone:"(817)555-0623",verified:false,photoSent:false,customerConfirmed:false,paid:false,eta:"—",progress:10},
  {id:"DS-4C2E9F",customer:"Apex Builders",driver:null,material:"Sand",yards:60,city:"Irving",status:"quoted",statusTime:180,value:1080,phone:"(469)555-0199",verified:false,photoSent:false,customerConfirmed:false,paid:false,eta:"—",progress:0},
  {id:"DS-7F1A3B",customer:"Crown Development",driver:null,material:"Fill Dirt",yards:300,city:"McKinney",status:"payment_pending",statusTime:240,value:4500,phone:"(214)555-0287",verified:false,photoSent:false,customerConfirmed:false,paid:false,eta:"—",progress:0},
  {id:"DS-9D5E2C",customer:"Smith Residential",driver:"Tyler K.",material:"Topsoil",yards:24,city:"Frisco",status:"scheduled",statusTime:30,value:480,phone:"(469)555-0445",verified:false,photoSent:false,customerConfirmed:false,paid:true,eta:"Tomorrow 8AM",progress:5},
  {id:"DS-B3F7A1",customer:"DFW Grading LLC",driver:"Carlos M.",material:"Base Course",yards:800,city:"Dallas",status:"delivered",statusTime:45,value:14400,phone:"(214)555-0511",verified:true,photoSent:true,customerConfirmed:false,paid:true,eta:"—",progress:100},
];

const STATUS_CONFIG: Record<OrderStatus, StatusConfig> = {
  quoted:{label:"QUOTED",color:C.blue,icon:"Q",maxMin:120,escalateMsg:"Lead going cold"},
  payment_pending:{label:"AWAITING PAY",color:C.amber,icon:"$",maxMin:180,escalateMsg:"Payment overdue"},
  scheduled:{label:"SCHEDULED",color:C.cyan,icon:"S",maxMin:null,escalateMsg:null},
  dispatched:{label:"DISPATCHED",color:C.blue,icon:"D",maxMin:60,escalateMsg:"No driver update"},
  loading:{label:"LOADING",color:C.cyan,icon:"L",maxMin:45,escalateMsg:"Loading too long"},
  in_transit:{label:"IN TRANSIT",color:C.green,icon:"T",maxMin:90,escalateMsg:"Delivery overdue"},
  arriving:{label:"ARRIVING",color:C.greenB,icon:"A",maxMin:15,escalateMsg:"Not confirmed"},
  delivered:{label:"DELIVERED",color:C.amber,icon:"V",maxMin:120,escalateMsg:"Unverified delivery"},
  verified:{label:"VERIFIED",color:C.green,icon:"✓",maxMin:null,escalateMsg:null},
  complete:{label:"COMPLETE",color:C.green,icon:"★",maxMin:null,escalateMsg:null},
};

const HEAT_ZONES: HeatZone[] = [
  {id:"h1",name:"Downtown Dallas",lat:32.78,lng:-96.80,orders:34,drivers:8,revenue:18200,temp:"hot",permits:12,txdot:2},
  {id:"h2",name:"North Dallas",lat:32.92,lng:-96.77,orders:22,drivers:5,revenue:11400,temp:"warm",permits:8,txdot:0},
  {id:"h3",name:"Fort Worth",lat:32.75,lng:-97.33,orders:28,drivers:7,revenue:15600,temp:"hot",permits:15,txdot:3},
  {id:"h4",name:"Arlington",lat:32.73,lng:-97.11,orders:18,drivers:4,revenue:9200,temp:"warm",permits:6,txdot:1},
  {id:"h5",name:"Plano",lat:33.02,lng:-96.70,orders:15,drivers:3,revenue:7800,temp:"warm",permits:9,txdot:0},
  {id:"h6",name:"Irving",lat:32.81,lng:-96.95,orders:8,drivers:2,revenue:4100,temp:"cool",permits:4,txdot:1},
  {id:"h7",name:"Mesquite",lat:32.77,lng:-96.60,orders:12,drivers:3,revenue:6400,temp:"warm",permits:3,txdot:0},
  {id:"h8",name:"Denton",lat:33.21,lng:-97.13,orders:3,drivers:0,revenue:1500,temp:"cold",permits:7,txdot:2},
  {id:"h9",name:"Frisco",lat:33.15,lng:-96.82,orders:10,drivers:2,revenue:5200,temp:"warm",permits:14,txdot:0},
  {id:"h10",name:"Mansfield",lat:32.56,lng:-97.14,orders:7,drivers:1,revenue:3600,temp:"cool",permits:2,txdot:0},
  {id:"h11",name:"Rockwall",lat:32.93,lng:-96.46,orders:5,drivers:1,revenue:2600,temp:"cool",permits:5,txdot:1},
  {id:"h12",name:"Southlake",lat:32.94,lng:-97.13,orders:11,drivers:2,revenue:5800,temp:"warm",permits:6,txdot:0},
];

const LEARNING=[
  {w:"W1",p:62,d:58,m:55,c:61},{w:"W2",p:65,d:63,m:59,c:66},
  {w:"W3",p:71,d:68,m:64,c:72},{w:"W4",p:76,d:74,m:71,c:78},
  {w:"W5",p:79,d:78,m:76,c:82},{w:"W6",p:83,d:82,m:80,c:86},
  {w:"W7",p:86,d:85,m:83,c:89},{w:"W8",p:88,d:87,m:86,c:91},
];

const CONVERSATIONS: Conversation[] = [
  {id:1,agent:"sarah",name:"Mike Rodriguez",phone:"(214)555-0187",status:"quoting",msgs:[
    {f:"cust",t:"Hi need fill dirt in Dallas",tm:"2:41"},
    {f:"ai",t:"Hey Mike! What's the delivery address so I can quote you?",tm:"2:41"},
    {f:"cust",t:"4521 Oak Lawn Ave Dallas TX",tm:"2:42"},
    {f:"ai",t:"For fill dirt in Dallas, standard $12/yd (3-5 days) or priority $15/yd (by Friday). How many yards?",tm:"2:42"},
  ],value:2400,yards:200},
  {id:2,agent:"jesse",name:"Carlos M. (DR-47)",phone:"(817)555-0342",status:"dispatched",msgs:[
    {f:"ai",t:"DS-C7EF5F — Blue Ridge — 90 yds $50/load. Send pic",tm:"1:15"},
    {f:"drv",t:"[Photo]",tm:"1:18"},
    {f:"ai",t:"Clean. Customer approved. Head to 713 N Texas 78, Blue Ridge TX",tm:"1:22"},
    {f:"drv",t:"On route ETA 25 min",tm:"1:45"},
  ],value:4500,yards:90},
  {id:3,agent:"sarah",name:"Tom Builder Inc",phone:"(682)555-0445",status:"closing",msgs:[
    {f:"cust",t:"500 yards base course for commercial project",tm:"11:30"},
    {f:"ai",t:"500 yards — where's the delivery?",tm:"11:30"},
    {f:"cust",t:"2100 E Lamar Blvd Arlington",tm:"11:31"},
    {f:"ai",t:"Standard $18/yd ($9,000) or Priority $22/yd ($11,000). Both include delivery.",tm:"11:33"},
    {f:"cust",t:"Priority. Venmo right?",tm:"2:15"},
  ],value:11000,yards:500},
];

// ── Components ──
function Pulse({color, sz = 6}: {color: string; sz?: number}) {
  return (
    <span style={{position:"relative",display:"inline-block",width:sz,height:sz}}>
      <span style={{position:"absolute",inset:-2,borderRadius:"50%",background:color,opacity:0.4,animation:"ep 2s ease-out infinite"}} />
      <span style={{display:"block",width:sz,height:sz,borderRadius:"50%",background:color}} />
    </span>
  );
}
function Bdg({children, color, bg}: {children: React.ReactNode; color: string; bg?: string}) {
  return (
    <span style={{fontSize:8,fontWeight:700,fontFamily:m,color:color,background:bg || `${color}20`,padding:"2px 6px",borderRadius:3,letterSpacing:0.6}}>{children}</span>
  );
}

function AndonCard({order,onClick,isSelected}: {order: Order; onClick: () => void; isSelected: boolean}){
  const cfg=STATUS_CONFIG[order.status]||STATUS_CONFIG.quoted;
  const isEscalated=cfg.maxMin!=null&&order.statusTime>cfg.maxMin;
  const isWarning=cfg.maxMin!=null&&order.statusTime>(cfg.maxMin*0.7);
  const needsVerify=order.status==="delivered"&&!order.customerConfirmed;
  const borderColor=isEscalated?C.red:isWarning?C.amber:needsVerify?C.amber:cfg.color;

  return(
    <div onClick={onClick} style={{
      padding:"8px 10px",background:isSelected?C.cardH:C.card,borderRadius:6,
      border:`1px solid ${isSelected?borderColor:C.b}`,borderLeft:`3px solid ${borderColor}`,
      cursor:"pointer",marginBottom:4,transition:"all .15s",position:"relative",
    }}>
      {isEscalated&&<div style={{position:"absolute",top:4,right:6,width:8,height:8,borderRadius:"50%",background:C.red,animation:"ep 1s ease infinite"}}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <span style={{fontSize:10,fontWeight:700,fontFamily:m,color:C.amberB}}>{order.id}</span>
          <Bdg color={cfg.color}>{cfg.label}</Bdg>
        </div>
        <span style={{fontSize:11,fontWeight:800,fontFamily:m,color:C.green}}>${order.value.toLocaleString()}</span>
      </div>
      <div style={{fontSize:10,color:C.t,marginBottom:2}}>{order.customer} — {order.city}</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:C.tD}}>{order.yards} yds {order.material}</span>
        <span style={{fontSize:9,fontFamily:m,color:isEscalated?C.red:isWarning?C.amber:C.tD}}>
          {order.statusTime}m in state{isEscalated?" — ESCALATED":""}
        </span>
      </div>
      {/* Verification checklist */}
      <div style={{display:"flex",gap:8,marginTop:4}}>
        {[
          {l:"Paid",v:order.paid},{l:"Photo",v:order.photoSent},{l:"Delivered",v:order.status==="delivered"||order.status==="verified"||order.status==="complete"},
          {l:"Verified",v:order.verified},{l:"Confirmed",v:order.customerConfirmed},
        ].map((c,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:2}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:c.v?C.green:C.b}}/>
            <span style={{fontSize:7,color:c.v?C.green:C.tD,fontFamily:m}}>{c.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatMap({zones,sel,onSel,showPermits,showDOT}: {
  zones: HeatZone[]; sel: HeatZone | null; onSel: (z: HeatZone | null) => void;
  showPermits: boolean; showDOT: boolean;
}){
  const W=480,H=300;
  const lr:[number,number]=[32.45,33.30],lnr:[number,number]=[-97.90,-96.35];
  const toX=(lng:number)=>((lng-lnr[0])/(lnr[1]-lnr[0]))*W;
  const toY=(lat:number)=>((lr[1]-lat)/(lr[1]-lr[0]))*H;
  const tc:Record<HeatZone["temp"],string>={hot:C.red,warm:C.amber,cool:C.blue,cold:"#1e3a5f"};
  const tg:Record<HeatZone["temp"],string>={hot:"rgba(239,68,68,.35)",warm:"rgba(245,158,11,.25)",cool:"rgba(59,130,246,.12)",cold:"rgba(30,58,95,.08)"};

  return(
    <div style={{position:"relative",width:W,height:H,background:C.bg,borderRadius:8,border:`1px solid ${C.b}`,overflow:"hidden"}}>
      <svg width={W} height={H} style={{position:"absolute",inset:0}}>
        {Array.from({length:10},(_,i)=><line key={`v${i}`} x1={i*(W/9)} y1={0} x2={i*(W/9)} y2={H} stroke={C.b} strokeWidth={.4} opacity={.3}/>)}
        {Array.from({length:7},(_,i)=><line key={`h${i}`} x1={0} y1={i*(H/6)} x2={W} y2={i*(H/6)} stroke={C.b} strokeWidth={.4} opacity={.3}/>)}
      </svg>
      {zones.map(z=>{
        const x=toX(z.lng),y=toY(z.lat),r=Math.max(12,Math.min(34,z.orders*1.1));
        const isSel=sel?.id===z.id;
        return(
          <div key={z.id} onClick={()=>onSel(isSel?null:z)} style={{
            position:"absolute",left:x-r,top:y-r,width:r*2,height:r*2,borderRadius:"50%",cursor:"pointer",
            background:`radial-gradient(circle,${tg[z.temp]},transparent 70%)`,
            border:isSel?`2px solid ${tc[z.temp]}`:`1px solid ${tc[z.temp]}40`,
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:isSel?`0 0 16px ${tc[z.temp]}40`:"none",zIndex:isSel?10:1,transition:"all .2s",
          }}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:10,fontWeight:800,fontFamily:m,color:tc[z.temp]}}>{z.orders}</div>
              {r>18&&<div style={{fontSize:6,color:C.tD,fontFamily:m}}>{z.name.split(" ")[0]}</div>}
            </div>
          </div>
        );
      })}
      {/* Permit overlays */}
      {showPermits&&zones.filter(z=>z.permits>5).map(z=>{
        const x=toX(z.lng),y=toY(z.lat);
        return (<div key={`p${z.id}`} style={{position:"absolute",left:x+12,top:y-14,fontSize:7,fontFamily:m,color:C.purple,background:`${C.purple}15`,padding:"1px 3px",borderRadius:2,border:`1px solid ${C.purple}30`,pointerEvents:"none"}}>
          {z.permits} permits
        </div>);
      })}
      {/* DOT overlays */}
      {showDOT&&zones.filter(z=>z.txdot>0).map(z=>{
        const x=toX(z.lng),y=toY(z.lat);
        return (<div key={`d${z.id}`} style={{position:"absolute",left:x-16,top:y+12,fontSize:7,fontFamily:m,color:C.cyan,background:`${C.cyan}15`,padding:"1px 3px",borderRadius:2,border:`1px solid ${C.cyan}30`,pointerEvents:"none"}}>
          {z.txdot} TxDOT
        </div>);
      })}
      <div style={{position:"absolute",top:5,left:6,fontSize:8,fontFamily:m,color:C.tD,letterSpacing:1}}>DFW DEMAND INTELLIGENCE</div>
      <div style={{position:"absolute",bottom:4,right:5,display:"flex",gap:6,background:`${C.bg}cc`,padding:"2px 5px",borderRadius:3}}>
        {([["HOT",C.red],["WARM",C.amber],["COOL",C.blue],["COLD","#1e3a5f"]] as const).map(([l,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:2}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:c}}/><span style={{fontSize:6,fontFamily:m,color:C.tD}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ──
export default function EarthCommandV3(){
  const [tab,setTab]=useState<"orders"|"map"|"convos"|"brain">("orders");
  const [selOrder,setSelOrder]=useState<Order|null>(null);
  const [selConv,setSelConv]=useState<Conversation|null>(null);
  const [selZone,setSelZone]=useState<HeatZone|null>(null);
  const [takeover,setTakeover]=useState(false);
  const [msgIn,setMsgIn]=useState("");
  const [sentMsgs,setSentMsgs]=useState<Array<{cid:number;f:string;t:string;tm:string}>>([]);
  const [showPermits,setShowPermits]=useState(true);
  const [showDOT,setShowDOT]=useState(true);
  const [now,setNow]=useState(new Date());
  const [orderFilter,setOrderFilter]=useState<string>("all");
  const ref=useRef<HTMLDivElement>(null);

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t)},[]);
  useEffect(()=>{ref.current?.scrollIntoView({behavior:"smooth"})},[selConv,sentMsgs]);

  const latestIQ=LEARNING[LEARNING.length-1];
  const pIQ=Math.round((latestIQ.p+latestIQ.d+latestIQ.m+latestIQ.c)/4);

  const escalated=ORDERS.filter(o=>{const cfg=STATUS_CONFIG[o.status];return cfg?.maxMin!=null&&o.statusTime>cfg.maxMin});
  const needsAttention=ORDERS.filter(o=>o.status==="delivered"&&!o.customerConfirmed);
  const activeOrders=ORDERS.filter(o=>!["verified","complete"].includes(o.status));
  const filteredOrders=orderFilter==="all"?ORDERS:orderFilter==="escalated"?escalated:orderFilter==="attention"?[...escalated,...needsAttention]:ORDERS.filter(o=>o.status===orderFilter);

  const totalPipeline=ORDERS.reduce((s,o)=>s+o.value,0);
  const todayRevenue=ORDERS.filter(o=>o.paid).reduce((s,o)=>s+o.value,0);

  const sendMsg=()=>{if(!msgIn.trim()||!selConv)return;setSentMsgs(p=>[...p,{cid:selConv.id,f:"admin",t:msgIn,tm:now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}]);setMsgIn("")};

  return(
    <div style={{background:C.bg,minHeight:"100vh",color:C.t,fontFamily:sn,overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.b};border-radius:3px}
        @keyframes ep{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(2.2);opacity:0}}
        @keyframes ef{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes eg{0%,100%{opacity:.5}50%{opacity:1}}
      `}</style>

      {/* HEADER */}
      <div style={{background:C.s,borderBottom:`1px solid ${C.b}`,padding:"5px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",height:42}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:24,height:24,borderRadius:4,background:`linear-gradient(135deg,${C.amber},${C.amber}88)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:C.bg}}>E</div>
          <div><div style={{fontSize:11,fontWeight:800,letterSpacing:2.5,fontFamily:m,lineHeight:1}}>EARTH COMMAND</div><div style={{fontSize:6,color:C.tD,letterSpacing:2.5,fontFamily:m}}>OPERATIONS ASSURANCE</div></div>
          <div style={{width:1,height:18,background:C.b,margin:"0 4px"}}/>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:8,fontFamily:m}}>
            <span style={{display:"flex",alignItems:"center",gap:2}}><Pulse color={C.green}/><span style={{color:C.green}}>SARAH</span></span>
            <span style={{display:"flex",alignItems:"center",gap:2}}><Pulse color={C.amber}/><span style={{color:C.amber}}>JESSE</span></span>
          </div>
          <div style={{width:1,height:18,background:C.b,margin:"0 4px"}}/>
          {/* Platform IQ */}
          <div style={{display:"flex",alignItems:"center",gap:3,background:`${C.green}12`,padding:"2px 7px",borderRadius:4,border:`1px solid ${C.green}25`}}>
            <span style={{fontSize:7,fontFamily:m,color:C.tD}}>IQ</span>
            <span style={{fontSize:12,fontWeight:800,fontFamily:m,color:C.green,animation:"eg 3s ease infinite"}}>{pIQ}</span>
          </div>
          {/* Escalation counter */}
          {escalated.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:3,background:C.redD,padding:"2px 7px",borderRadius:4,border:`1px solid ${C.red}30`}}>
              <Pulse color={C.red} sz={5}/>
              <span style={{fontSize:9,fontFamily:m,color:C.red,fontWeight:700}}>{escalated.length} ESCALATED</span>
            </div>
          )}
          {needsAttention.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:3,background:C.amberD,padding:"2px 7px",borderRadius:4,border:`1px solid ${C.amber}30`}}>
              <span style={{fontSize:9,fontFamily:m,color:C.amber,fontWeight:700}}>{needsAttention.length} UNVERIFIED</span>
            </div>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:2}}>
            {([{k:"orders",l:"ORDERS"},{k:"map",l:"INTEL MAP"},{k:"convos",l:"LIVE CHAT"},{k:"brain",l:"BRAIN"}] as const).map(t=>(
              <button key={t.k} onClick={()=>{setTab(t.k);setSelOrder(null);setSelConv(null)}} style={{
                background:tab===t.k?`${C.amber}15`:"transparent",border:tab===t.k?`1px solid ${C.amber}35`:"1px solid transparent",
                color:tab===t.k?C.amber:C.tD,fontSize:8,fontFamily:m,fontWeight:600,padding:"3px 7px",borderRadius:3,cursor:"pointer",letterSpacing:.7,
              }}>{t.l}</button>
            ))}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,fontWeight:700,fontFamily:m}}>{now.toLocaleTimeString("en-US",{hour12:true,hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
            <div style={{fontSize:6,color:C.tD,fontFamily:m}}>{now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
          </div>
        </div>
      </div>

      {/* KPI BAR */}
      <div style={{background:C.s,borderBottom:`1px solid ${C.b}`,padding:"5px 14px",display:"flex",gap:6}}>
        {[
          {l:"PIPELINE",v:`$${totalPipeline.toLocaleString()}`,c:C.amberB,s:`${ORDERS.length} orders`},
          {l:"COLLECTED",v:`$${todayRevenue.toLocaleString()}`,c:C.green,s:`${ORDERS.filter(o=>o.paid).length} paid`},
          {l:"ACTIVE",v:activeOrders.length,c:C.blue,s:`${ORDERS.filter(o=>o.status==="in_transit").length} transit`},
          {l:"ESCALATED",v:escalated.length,c:escalated.length>0?C.red:C.green,s:escalated.length>0?"NEEDS ACTION":"All clear"},
          {l:"UNVERIFIED",v:needsAttention.length,c:needsAttention.length>0?C.amber:C.green,s:needsAttention.length>0?"Confirm delivery":"All verified"},
          {l:"IQ TREND",v:`${pIQ}/100`,c:C.green,s:"+3 this week"},
        ].map((k,i)=>(
          <div key={i} style={{flex:1,padding:"6px 8px",background:C.card,borderRadius:5,border:`1px solid ${C.b}`,minWidth:0}}>
            <div style={{fontSize:7,color:C.tD,fontFamily:m,letterSpacing:1,marginBottom:2}}>{k.l}</div>
            <div style={{fontSize:16,fontWeight:800,fontFamily:m,color:k.c,lineHeight:1}}>{k.v}</div>
            <div style={{fontSize:8,color:C.tD,marginTop:1}}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div style={{display:"flex",height:"calc(100vh - 42px - 50px)"}}>

        {/* LEFT CONTENT */}
        <div style={{flex:1,overflow:"auto",padding:12,animation:"ef .2s ease"}}>

          {tab==="orders"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1}}>ORDER ASSURANCE BOARD</div>
                <div style={{display:"flex",gap:3}}>
                  {[{k:"all",l:"ALL"},{k:"escalated",l:"ESCALATED"},{k:"attention",l:"NEEDS ATTN"},{k:"in_transit",l:"TRANSIT"},{k:"delivered",l:"DELIVERED"}].map(f=>(
                    <button key={f.k} onClick={()=>setOrderFilter(f.k)} style={{
                      background:orderFilter===f.k?`${C.amber}15`:"transparent",border:orderFilter===f.k?`1px solid ${C.amber}30`:"1px solid transparent",
                      color:orderFilter===f.k?C.amber:C.tD,fontSize:7,fontFamily:m,padding:"2px 6px",borderRadius:3,cursor:"pointer",fontWeight:600,
                    }}>{f.l} ({f.k==="all"?ORDERS.length:f.k==="escalated"?escalated.length:f.k==="attention"?escalated.length+needsAttention.length:ORDERS.filter(o=>o.status===f.k).length})</button>
                  ))}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {filteredOrders.map(o=><AndonCard key={o.id} order={o} isSelected={selOrder?.id===o.id} onClick={()=>setSelOrder(selOrder?.id===o.id?null:o)}/>)}
              </div>
              {selOrder&&(
                <div style={{marginTop:10,background:C.card,borderRadius:8,border:`1px solid ${C.b}`,padding:14,animation:"ef .2s ease"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700}}>{selOrder.customer}</div>
                      <div style={{fontSize:10,fontFamily:m,color:C.tD}}>{selOrder.id} — {selOrder.phone} — {selOrder.city}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontWeight:800,fontFamily:m,color:C.green}}>${selOrder.value.toLocaleString()}</div>
                      <Bdg color={STATUS_CONFIG[selOrder.status]?.color||C.blue}>{STATUS_CONFIG[selOrder.status]?.label}</Bdg>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,fontFamily:m,color:C.tD,marginBottom:3}}>
                      {["Quoted","Paid","Dispatched","Loading","Transit","Delivered","Verified"].map((s,i)=><span key={i}>{s}</span>)}
                    </div>
                    <div style={{height:6,background:C.b,borderRadius:3,overflow:"hidden"}}>
                      <div style={{width:`${selOrder.progress}%`,height:"100%",background:`linear-gradient(90deg,${C.blue},${C.green})`,borderRadius:3,transition:"width .5s"}}/>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:10}}>
                    <div><span style={{color:C.tD}}>Material:</span> <span style={{color:C.t}}>{selOrder.yards} yds {selOrder.material}</span></div>
                    <div><span style={{color:C.tD}}>Driver:</span> <span style={{color:C.t}}>{selOrder.driver||"Unassigned"}</span></div>
                    <div><span style={{color:C.tD}}>ETA:</span> <span style={{color:C.amber,fontFamily:m}}>{selOrder.eta}</span></div>
                    <div><span style={{color:C.tD}}>Time in state:</span> <span style={{color:selOrder.statusTime>90?C.red:C.t,fontFamily:m}}>{selOrder.statusTime} min</span></div>
                    <div><span style={{color:C.tD}}>Paid:</span> <span style={{color:selOrder.paid?C.green:C.red}}>{selOrder.paid?"Yes":"No"}</span></div>
                    <div><span style={{color:C.tD}}>Verified:</span> <span style={{color:selOrder.verified?C.green:C.amber}}>{selOrder.verified?"Yes":"Pending"}</span></div>
                  </div>
                  {!selOrder.customerConfirmed&&selOrder.status==="delivered"&&(
                    <div style={{marginTop:8,padding:"6px 10px",background:C.amberD,borderRadius:4,border:`1px solid ${C.amber}30`,fontSize:10,color:C.amber,fontFamily:m}}>
                      ACTION REQUIRED: Customer has not confirmed delivery. Auto follow-up in {120-selOrder.statusTime} min. Click to send manual confirmation request.
                    </div>
                  )}
                </div>
              )}
              {/* Daily Briefing */}
              <div style={{marginTop:14,background:C.card,borderRadius:8,border:`1px solid ${C.b}`,padding:12}}>
                <div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:8}}>DAILY BRIEFING — {now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
                {[
                  {icon:"!",color:C.red,msg:`${escalated.length} orders escalated — DS-8E3F1A dispatched 95 min ago with no driver update. DS-7F1A3B payment pending for 4 hours.`},
                  {icon:"$",color:C.green,msg:`$${todayRevenue.toLocaleString()} collected today. $${(totalPipeline-todayRevenue).toLocaleString()} outstanding. Tom Builder $11K closing now.`},
                  {icon:"~",color:C.amber,msg:`DS-B3F7A1 delivered but customer hasn't confirmed (45 min). Auto text fires in 75 min if no response.`},
                  {icon:"^",color:C.purple,msg:`Platform IQ at ${pIQ} (+3 this week). Sarah close rate 42%. Pricing model learned $12/yd optimal for Zone A fill dirt.`},
                  {icon:"*",color:C.cyan,msg:`Fort Worth demand up 34% WoW — 15 new building permits filed. Denton has 7 permits but 0 drivers. Deploy fleet.`},
                ].map((b,i)=>(
                  <div key={i} style={{padding:"5px 8px",borderLeft:`2px solid ${b.color}`,background:`${C.bg}80`,borderRadius:"0 4px 4px 0",marginBottom:3}}>
                    <span style={{fontSize:10,color:C.t,lineHeight:1.4}}>{b.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab==="map"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1}}>DEMAND INTELLIGENCE + GOV DATA</div>
                <div style={{display:"flex",gap:6}}>
                  <label style={{display:"flex",alignItems:"center",gap:3,fontSize:8,fontFamily:m,color:showPermits?C.purple:C.tD,cursor:"pointer"}}>
                    <input type="checkbox" checked={showPermits} onChange={e=>setShowPermits(e.target.checked)} style={{width:10,height:10,accentColor:C.purple}}/>PERMITS
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:3,fontSize:8,fontFamily:m,color:showDOT?C.cyan:C.tD,cursor:"pointer"}}>
                    <input type="checkbox" checked={showDOT} onChange={e=>setShowDOT(e.target.checked)} style={{width:10,height:10,accentColor:C.cyan}}/>TxDOT
                  </label>
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <HeatMap zones={HEAT_ZONES} sel={selZone} onSel={setSelZone} showPermits={showPermits} showDOT={showDOT}/>
                <div style={{width:200}}>
                  {selZone?(
                    <div style={{background:C.card,borderRadius:6,border:`1px solid ${C.b}`,padding:10}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>{selZone.name}</div>
                      {([["Orders",selZone.orders,C.amber],["Revenue",`$${selZone.revenue.toLocaleString()}`,C.green],["Drivers",selZone.drivers,C.blue],
                        ["Permits",selZone.permits,C.purple],["TxDOT Projects",selZone.txdot,C.cyan],
                      ] as const).map(([l,v,c],i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:i<4?`1px solid ${C.b}`:"none"}}>
                          <span style={{fontSize:9,color:C.tD}}>{l}</span>
                          <span style={{fontSize:11,fontWeight:700,fontFamily:m,color:c}}>{v}</span>
                        </div>
                      ))}
                      {selZone.permits>10&&<div style={{marginTop:6,padding:"4px 6px",background:`${C.purple}12`,borderRadius:3,border:`1px solid ${C.purple}25`,fontSize:8,color:C.purple,fontFamily:m}}>HIGH PERMIT ZONE — Future demand predicted +{Math.round(selZone.permits*2.5)}%</div>}
                      {selZone.txdot>0&&<div style={{marginTop:4,padding:"4px 6px",background:`${C.cyan}12`,borderRadius:3,border:`1px solid ${C.cyan}25`,fontSize:8,color:C.cyan,fontFamily:m}}>{selZone.txdot} DOT project(s) — estimated {selZone.txdot*500} yds aggregate demand</div>}
                      {selZone.drivers===0&&<div style={{marginTop:4,padding:"4px 6px",background:C.redD,borderRadius:3,border:`1px solid ${C.red}25`,fontSize:8,color:C.red,fontFamily:m}}>DEAD ZONE — 0 drivers. Deploy fleet here.</div>}
                    </div>
                  ):(
                    <div style={{background:C.card,borderRadius:6,border:`1px solid ${C.b}`,padding:10,fontSize:9,color:C.tD}}>Click a zone. Toggle permit and TxDOT overlays to see future demand prediction.</div>
                  )}
                  <div style={{marginTop:8,fontSize:9,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:4}}>DEMAND FORECAST</div>
                  {HEAT_ZONES.filter(z=>z.permits>5).sort((a,b)=>b.permits-a.permits).slice(0,4).map(z=>(
                    <div key={z.id} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",marginBottom:2,background:C.card,borderRadius:3,cursor:"pointer"}} onClick={()=>setSelZone(z)}>
                      <span style={{fontSize:9,color:C.t}}>{z.name}</span>
                      <span style={{fontSize:8,fontFamily:m,color:C.purple}}>+{z.permits} permits</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab==="convos"&&(
            <div style={{display:"flex",gap:10,height:"100%"}}>
              <div style={{width:260,overflowY:"auto"}}>
                <div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:6}}>LIVE CONVERSATIONS</div>
                {CONVERSATIONS.map(c=>{
                  const ac=c.agent==="sarah"?C.blue:C.amber;
                  return(
                    <div key={c.id} onClick={()=>{setSelConv(c);setTakeover(false);setSentMsgs([])}} style={{
                      padding:"8px 10px",background:selConv?.id===c.id?C.cardH:C.card,borderRadius:6,
                      border:`1px solid ${selConv?.id===c.id?ac:C.b}`,borderLeft:`3px solid ${ac}`,
                      cursor:"pointer",marginBottom:4,
                    }}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <Bdg color={ac}>{c.agent.toUpperCase()}</Bdg>
                          <span style={{fontSize:10,fontWeight:600}}>{c.name}</span>
                        </div>
                        <span style={{fontSize:10,fontFamily:m,color:C.green,fontWeight:700}}>${c.value?.toLocaleString()}</span>
                      </div>
                      <div style={{fontSize:9,color:C.tD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.msgs[c.msgs.length-1]?.t}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{flex:1,display:"flex",flexDirection:"column",background:C.card,borderRadius:8,border:`1px solid ${C.b}`}}>
                {selConv?(
                  <>
                    <div style={{padding:"6px 12px",borderBottom:`1px solid ${C.b}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><span style={{fontSize:11,fontWeight:600}}>{selConv.name}</span><span style={{fontSize:9,fontFamily:m,color:C.tD,marginLeft:6}}>{selConv.phone}</span></div>
                      <button onClick={()=>setTakeover(!takeover)} style={{
                        background:takeover?C.redD:`${C.amber}12`,border:`1px solid ${takeover?C.red:C.amber}35`,
                        color:takeover?C.red:C.amber,fontSize:8,fontFamily:m,fontWeight:700,padding:"3px 8px",borderRadius:3,cursor:"pointer",
                      }}>{takeover?"LIVE — AI PAUSED":"TAKE OVER"}</button>
                    </div>
                    {takeover&&<div style={{padding:"3px 12px",background:C.redD,borderBottom:`1px solid ${C.red}25`,fontSize:8,fontFamily:m,color:C.red,display:"flex",alignItems:"center",gap:4}}><Pulse color={C.red} sz={4}/>HUMAN OVERRIDE — Sends from {selConv.agent==="sarah"?"Sarah":"Jesse"}&apos;s Twilio number</div>}
                    <div style={{flex:1,overflowY:"auto",padding:12}}>
                      {selConv.msgs.map((msg,i)=>{
                        const isAI=msg.f==="ai";const ac=selConv.agent==="sarah"?C.blue:C.amber;
                        return(
                          <div key={i} style={{display:"flex",justifyContent:isAI?"flex-end":"flex-start",marginBottom:6}}>
                            <div style={{maxWidth:"78%",padding:"6px 10px",borderRadius:isAI?"8px 8px 2px 8px":"8px 8px 8px 2px",background:isAI?`${ac}12`:C.s,border:`1px solid ${isAI?`${ac}25`:C.b}`}}>
                              <div style={{fontSize:11,color:C.t,lineHeight:1.4}}>{msg.t}</div>
                              <div style={{fontSize:7,color:isAI?ac:C.tD,fontFamily:m,marginTop:2,textAlign:isAI?"right":"left"}}>{isAI?selConv.agent.toUpperCase():msg.f==="drv"?"DRIVER":"CUSTOMER"} — {msg.tm}</div>
                            </div>
                          </div>
                        );
                      })}
                      {sentMsgs.filter(s=>s.cid===selConv.id).map((msg,i)=>(
                        <div key={`s${i}`} style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
                          <div style={{maxWidth:"78%",padding:"6px 10px",borderRadius:"8px 8px 2px 8px",background:C.redD,border:`1px solid ${C.red}25`}}>
                            <div style={{fontSize:11,color:C.t,lineHeight:1.4}}>{msg.t}</div>
                            <div style={{fontSize:7,color:C.red,fontFamily:m,marginTop:2,textAlign:"right"}}>YOU (as {selConv.agent.toUpperCase()}) — {msg.tm}</div>
                          </div>
                        </div>
                      ))}
                      <div ref={ref}/>
                    </div>
                    {takeover&&(
                      <div style={{padding:"6px 10px",borderTop:`1px solid ${C.b}`,display:"flex",gap:4}}>
                        <input value={msgIn} onChange={e=>setMsgIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()}
                          placeholder={`Message as ${selConv.agent==="sarah"?"Sarah":"Jesse"}...`}
                          style={{flex:1,background:C.s,border:`1px solid ${C.red}35`,borderRadius:5,padding:"6px 10px",color:C.t,fontSize:11,fontFamily:sn,outline:"none"}}/>
                        <button onClick={sendMsg} style={{background:C.red,border:"none",color:"#fff",fontSize:9,fontFamily:m,fontWeight:700,padding:"6px 12px",borderRadius:5,cursor:"pointer"}}>SEND</button>
                      </div>
                    )}
                  </>
                ):<div style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,color:C.tD,fontSize:10,fontFamily:m}}>Select a conversation</div>}
              </div>
            </div>
          )}

          {tab==="brain"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1}}>PLATFORM INTELLIGENCE</div><div style={{fontSize:8,color:C.tM,marginTop:2}}>Every order makes us smarter. Every conversation trains us. Every delivery calibrates us.</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:32,fontWeight:900,fontFamily:m,color:C.green,lineHeight:1}}>{pIQ}</div><div style={{fontSize:8,color:C.tD}}>Platform IQ</div></div>
              </div>
              <div style={{background:C.card,borderRadius:8,border:`1px solid ${C.b}`,padding:"10px 6px 2px",marginBottom:12}}>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={LEARNING}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.amber} stopOpacity={.2}/><stop offset="100%" stopColor={C.amber} stopOpacity={0}/></linearGradient>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={.2}/><stop offset="100%" stopColor={C.green} stopOpacity={0}/></linearGradient>
                      <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={.2}/><stop offset="100%" stopColor={C.blue} stopOpacity={0}/></linearGradient>
                      <linearGradient id="g4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.purple} stopOpacity={.2}/><stop offset="100%" stopColor={C.purple} stopOpacity={0}/></linearGradient>
                    </defs>
                    <XAxis dataKey="w" tick={{fontSize:8,fill:C.tD,fontFamily:m}} axisLine={false} tickLine={false}/>
                    <YAxis domain={[50,100]} tick={{fontSize:8,fill:C.tD,fontFamily:m}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.b}`,borderRadius:4,fontFamily:m,fontSize:9}}/>
                    <Area type="monotone" dataKey="p" name="Pricing" stroke={C.amber} fill="url(#g1)" strokeWidth={2}/>
                    <Area type="monotone" dataKey="d" name="Delivery" stroke={C.green} fill="url(#g2)" strokeWidth={2}/>
                    <Area type="monotone" dataKey="m" name="Matching" stroke={C.blue} fill="url(#g3)" strokeWidth={2}/>
                    <Area type="monotone" dataKey="c" name="Conversation" stroke={C.purple} fill="url(#g4)" strokeWidth={2}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:6}}>WHAT THE SYSTEM LEARNED</div>
              {[
                {msg:"Dallas downtown orders peak 7-9 AM — pre-position 3 drivers by 6:30 AM",type:"dispatch",conf:94},
                {msg:"Fill dirt at $12/yd: 89% acceptance in Zone A. $14/yd drops to 61%. Keep $12 floor.",type:"pricing",conf:91},
                {msg:"Customers quoted within 2 min close at 3.2x vs 10+ min quotes",type:"conversion",conf:88},
                {msg:"Carlos accepts 97% of jobs within 15 mi — prioritize him for North Dallas",type:"matching",conf:86},
                {msg:"Fort Worth +34% WoW — correlates with 15 new building permits",type:"demand",conf:82},
                {msg:"Rain forecast Thursday — historically reduces orders 40%. Pre-notify scheduled customers.",type:"weather",conf:79},
              ].map((l,i)=>(
                <div key={i} style={{padding:"5px 8px",borderLeft:`2px solid ${l.type==="pricing"?C.amber:l.type==="dispatch"?C.green:l.type==="conversion"?C.purple:l.type==="matching"?C.blue:l.type==="demand"?C.cyan:C.pink}`,marginBottom:3,background:`${C.bg}80`,borderRadius:"0 4px 4px 0"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:10,color:C.t,lineHeight:1.3}}>{l.msg}</span>
                    <span style={{fontSize:8,fontFamily:m,color:C.green,minWidth:28,textAlign:"right"}}>{l.conf}%</span>
                  </div>
                </div>
              ))}
              <div style={{marginTop:14,fontSize:10,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:6}}>5-YEAR VISION — FEATURES WE HAVE BEFORE ANYONE ELSE</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {l:"Permit-to-Order Pipeline",d:"Auto-generate material estimates from new building permits. 185M+ permits via Shovels.ai integration.",s:"Patent XLVI",c:C.purple,ready:"Building"},
                  {l:"Weather-Responsive Dispatch",d:"Auto-adjust schedules based on NOAA forecasts. Pre-notify customers. Redistribute fleet.",s:"Patent V",c:C.cyan,ready:"Building"},
                  {l:"Material Quality CV",d:"Computer vision analyzes dirt/aggregate quality from driver photos. Auto-approve clean material.",s:"Patent I",c:C.amber,ready:"Active"},
                  {l:"AI-to-AI Negotiation",d:"Sarah and Jesse negotiate pricing and scheduling autonomously with supplier AI systems.",s:"Patent V",c:C.pink,ready:"2027"},
                  {l:"Autonomous Fleet Orchestration",d:"Air traffic control for autonomous dump trucks across public roads between quarries.",s:"Patent XXXVII",c:C.green,ready:"2028"},
                  {l:"Carbon Credit Per Delivery",d:"Track emissions per haul. Generate verified carbon credits. ESG compliance built-in.",s:"Patent XXVIII",c:C.greenB,ready:"2027"},
                  {l:"Digital Twin Job Sites",d:"3D model of every active construction site showing material needs in real-time.",s:"Patent XLVI",c:C.blue,ready:"2029"},
                  {l:"Federated Learning Network",d:"Multiple quarries train shared models without exposing proprietary data.",s:"Patent XLII",c:C.red,ready:"2030"},
                ].map((f,i)=>(
                  <div key={i} style={{background:C.card,borderRadius:6,border:`1px solid ${C.b}`,padding:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:700,color:f.c}}>{f.l}</span>
                      <Bdg color={f.ready==="Active"?C.green:f.ready==="Building"?C.amber:C.tD}>{f.ready}</Bdg>
                    </div>
                    <div style={{fontSize:9,color:C.tM,lineHeight:1.3,marginBottom:3}}>{f.d}</div>
                    <div style={{fontSize:7,fontFamily:m,color:C.tD}}>{f.s}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{width:220,minWidth:220,borderLeft:`1px solid ${C.b}`,display:"flex",flexDirection:"column",background:C.s,overflowY:"auto"}}>
          <div style={{padding:"8px 8px",borderBottom:`1px solid ${C.b}`}}>
            <div style={{fontSize:9,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:4}}>FOLLOW-UP QUEUE</div>
            {[
              {name:"Crown Development",hrs:4,val:"$4,500",reason:"Payment pending",urgent:true},
              {name:"DFW Grading LLC",hrs:0.75,val:"$14,400",reason:"Delivered — no customer confirm",urgent:true},
              {name:"Lisa Chen",hrs:24,val:"$3,600",reason:"Quoted — no response",urgent:false},
              {name:"Apex Builders",hrs:3,val:"$1,080",reason:"Quoted — going cold",urgent:false},
            ].map((f,i)=>(
              <div key={i} style={{padding:"5px 7px",background:C.card,borderRadius:4,border:`1px solid ${f.urgent?`${C.red}30`:C.b}`,marginBottom:3,borderLeft:`2px solid ${f.urgent?C.red:C.amber}`}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:10,fontWeight:600}}>{f.name}</span>
                  <span style={{fontSize:9,fontFamily:m,color:C.amber,fontWeight:700}}>{f.val}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:1}}>
                  <span style={{fontSize:8,color:C.tD}}>{f.reason}</span>
                  <span style={{fontSize:8,fontFamily:m,color:f.hrs>3?C.red:C.tD}}>{f.hrs}h</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{padding:"8px 8px",borderBottom:`1px solid ${C.b}`}}>
            <div style={{fontSize:9,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:4}}>SYSTEM</div>
            {([["Twilio SMS","operational","120ms"],["Supabase","operational","45ms"],["Claude Sonnet","operational","1.2s"],["Vercel","operational","32ms"],["10DLC","pending","—"]] as const).map(([l,s,ms],i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"2px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:4,height:4,borderRadius:"50%",background:s==="operational"?C.green:C.amber}}/><span style={{fontSize:8,color:C.tM}}>{l}</span></div>
                <span style={{fontSize:7,fontFamily:m,color:C.tD}}>{ms}</span>
              </div>
            ))}
          </div>
          <div style={{padding:"8px 8px"}}>
            <div style={{fontSize:9,fontFamily:m,color:C.tD,letterSpacing:1,marginBottom:4}}>DATA SOURCES</div>
            {[
              {l:"TxDOT ArcGIS",n:"11,000+ projects",c:C.cyan},
              {l:"Shovels.ai Permits",n:"185M+ permits",c:C.purple},
              {l:"SAM.gov",n:"Fed contracts",c:C.blue},
              {l:"NOAA Weather",n:"7-day forecast",c:C.pink},
              {l:"Supabase Fleet",n:"Real-time GPS",c:C.green},
            ].map((d,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
                <span style={{fontSize:8,color:d.c}}>{d.l}</span>
                <span style={{fontSize:7,fontFamily:m,color:C.tD}}>{d.n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
